require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const cheerio = require('cheerio');
const rateLimit = require('express-rate-limit');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// CONFIGURATION & MIDDLEWARE
// ============================================================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable for embedded videos
  crossOriginEmbedderPolicy: false
}));

// Compression
app.use(compression());

// Logging
app.use(morgan('combined'));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_me_please',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.'
});
app.use(limiter);

// API rate limiting (stricter)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  skip: (req) => !req.path.includes('/api/')
});
app.use(apiLimiter);

// ============================================================================
// IN-MEMORY CACHE
// ============================================================================

class SimpleCache {
  constructor(ttl = 300000) { // 5 minutes default
    this.cache = new Map();
    this.ttl = ttl;
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      expires: Date.now() + this.ttl
    });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  clear() {
    this.cache.clear();
  }
}

const searchCache = new SimpleCache(300000); // 5 min
const videoCache = new SimpleCache(600000);  // 10 min

// ============================================================================
// UTILITIES
// ============================================================================

// Axios instance with timeout and retry
const axiosInstance = axios.create({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});

// Retry logic
axiosInstance.interceptors.response.use(null, async (error) => {
  const config = error.config;
  if (!config || !config.retry) config.retry = 0;
  
  if (config.retry >= 3) return Promise.reject(error);
  
  config.retry += 1;
  const delay = new Promise(resolve => setTimeout(resolve, 1000 * config.retry));
  await delay;
  
  return axiosInstance(config);
});

// Input sanitization
function sanitizeInput(input) {
  if (!input) return '';
  return input.toString().trim().replace(/[<>]/g, '');
}

// Logger
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...data }));
}

// ============================================================================
// AUTHENTICATION & AUTHORIZATION
// ============================================================================

// Login routes
app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/admin');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === process.env.USERNAME && password === process.env.PASSWORD) {
    req.session.authenticated = true;
    req.session.loginTime = Date.now();
    log('info', 'User logged in', { username });
    return res.redirect('/admin');
  }
  
  log('warn', 'Failed login attempt', { username });
  res.render('login', { error: 'Wrong credentials' });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Middleware: Authentication
const auth = (req, res, next) => {
  if (req.session.authenticated) return next();
  res.redirect('/login');
};

// Middleware: API Key validation
const apiKey = (req, res, next) => {
  // Public routes
  const publicRoutes = ['/login', '/logout', '/docs', '/'];
  if (publicRoutes.includes(req.path)) return next();
  
  const key = req.query.key || req.headers['x-api-key'];
  
  if (key === process.env.API_KEY_MAIN) {
    req.apiKeyValid = true;
    return next();
  }
  
  return res.status(401).json({ 
    error: 'API key required',
    message: 'Please provide a valid API key via ?key=YOUR_KEY or x-api-key header'
  });
};

// ============================================================================
// SCRAPING FUNCTIONS
// ============================================================================

async function scrapeSearch(query, page = 1) {
  const cacheKey = `search:${query}:${page}`;
  const cached = searchCache.get(cacheKey);
  if (cached) {
    log('info', 'Cache hit for search', { query, page });
    return cached;
  }

  try {
    const url = page > 1 
      ? `https://www.xvideos.com/?k=${encodeURIComponent(query)}&p=${page}`
      : `https://www.xvideos.com/?k=${encodeURIComponent(query)}`;
    
    const { data } = await axiosInstance.get(url);
    const $ = cheerio.load(data);
    const results = [];

    $('div.thumb-block').each((i, el) => {
      const title = $(el).find('p.title a').text().trim();
      const href = $(el).find('p.title a').attr('href');
      const thumb = $(el).find('img.thumb').attr('data-src') || $(el).find('img').attr('src') || '';
      const duration = $(el).find('span.duration').text().trim();
      const views = $(el).find('span.views').text().trim();
      const rating = $(el).find('div.rating').text().trim();

      if (href?.startsWith('/video')) {
        const id = href.split('/')[2].split(/[/?#]/)[0];
        results.push({
          id,
          title,
          thumb: thumb.replace('thumbs/', 'thumbsxl/'),
          duration,
          views,
          rating,
          url: `https://www.xvideos.com${href}`
        });
      }
    });

    const response = {
      query,
      page,
      results,
      count: results.length,
      hasMore: results.length >= 27 // Typical page size
    };

    searchCache.set(cacheKey, response);
    log('info', 'Search completed', { query, page, count: results.length });
    
    return response;
  } catch (error) {
    log('error', 'Search failed', { query, page, error: error.message });
    throw error;
  }
}

async function scrapeVideo(id) {
  const cacheKey = `video:${id}`;
  const cached = videoCache.get(cacheKey);
  if (cached) {
    log('info', 'Cache hit for video', { id });
    return cached;
  }

  try {
    const { data } = await axiosInstance.get(`https://www.xvideos.com/video${id}/`);
    const $ = cheerio.load(data);

    const title = $('meta[property="og:title"]').attr('content') || $('h2.page-title').text().trim();
    const thumb = ($('meta[property="og:image"]').attr('content') || '').replace('thumbs/', 'thumbsxl/');
    const duration = $('span.duration').first().text().trim();
    const views = $('div#video-tabs strong.mobile-hide').first().text().trim();
    const rating = $('div.rating-bar span.value').text().trim();
    const description = $('meta[property="og:description"]').attr('content') || '';
    const embed = `https://www.xvideos.com/embedframe/${id}`;
    const tags = [];
    
    $('ul.video-tags a').each((i, el) => {
      tags.push($(el).text().trim());
    });

    // Extract video URLs
    let downloadUrl = null;
    const high = data.match(/setVideoUrlHigh\('([^']+)'\)/);
    const low = data.match(/setVideoUrlLow\('([^']+)'\)/);
    downloadUrl = high ? high[1] : (low ? low[1] : null);

    const response = {
      id,
      title,
      thumb,
      duration,
      views,
      rating,
      description,
      tags,
      embed,
      downloadUrl,
      url: `https://www.xvideos.com/video${id}/`
    };

    videoCache.set(cacheKey, response);
    log('info', 'Video scraped', { id, title });
    
    return response;
  } catch (error) {
    log('error', 'Video scraping failed', { id, error: error.message });
    throw error;
  }
}

// ============================================================================
// WEB ROUTES (Original functionality maintained)
// ============================================================================

app.get('/', (req, res) => res.redirect('/search'));

app.get('/search', apiKey, async (req, res) => {
  const q = sanitizeInput(req.query.q);
  const page = parseInt(req.query.page) || 1;
  
  if (!q) return res.render('search', { results: [], query: '', page: 1, hasMore: false });

  try {
    const data = await scrapeSearch(q, page);
    
    if (req.query.format === 'json') {
      return res.json(data);
    }
    
    res.render('search', { 
      results: data.results, 
      query: q,
      page: data.page,
      hasMore: data.hasMore
    });
  } catch (error) {
    log('error', 'Search route error', { query: q, error: error.message });
    res.status(500).send('Search error. Please try again later.');
  }
});

app.get('/video', apiKey, async (req, res) => {
  const id = sanitizeInput(req.query.id);
  
  if (!id) return res.status(400).json({ error: 'No video ID provided' });

  try {
    const video = await scrapeVideo(id);
    
    if (req.query.format === 'json') {
      return res.json(video);
    }
    
    res.render('video', video);
  } catch (error) {
    log('error', 'Video route error', { id, error: error.message });
    res.status(500).send('Video error. Please try again later.');
  }
});

app.get('/download', apiKey, (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'No download URL provided' });
  res.redirect(url);
});

// ============================================================================
// API ROUTES (New RESTful endpoints)
// ============================================================================

app.get('/api/v1/search', apiKey, async (req, res) => {
  try {
    const q = sanitizeInput(req.query.q);
    const page = parseInt(req.query.page) || 1;
    
    if (!q) {
      return res.status(400).json({ 
        error: 'Query parameter required',
        message: 'Please provide a search query using ?q=yourquery'
      });
    }
    
    const data = await scrapeSearch(q, page);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message
    });
  }
});

app.get('/api/v1/video/:id', apiKey, async (req, res) => {
  try {
    const id = sanitizeInput(req.params.id);
    const video = await scrapeVideo(id);
    
    res.json({
      success: true,
      data: video
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Video fetch failed',
      message: error.message
    });
  }
});

app.get('/api/v1/trending', apiKey, async (req, res) => {
  try {
    const { data } = await axiosInstance.get('https://www.xvideos.com/');
    const $ = cheerio.load(data);
    const trending = [];

    $('div.thumb-block').slice(0, 20).each((i, el) => {
      const title = $(el).find('p.title a').text().trim();
      const href = $(el).find('p.title a').attr('href');
      const thumb = $(el).find('img.thumb').attr('data-src') || $(el).find('img').attr('src') || '';
      const duration = $(el).find('span.duration').text().trim();

      if (href?.startsWith('/video')) {
        const id = href.split('/')[2].split(/[/?#]/)[0];
        trending.push({
          id,
          title,
          thumb: thumb.replace('thumbs/', 'thumbsxl/'),
          duration,
          url: `https://www.xvideos.com${href}`
        });
      }
    });

    res.json({
      success: true,
      data: {
        trending,
        count: trending.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trending',
      message: error.message
    });
  }
});

app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    cache: {
      search: searchCache.cache.size,
      video: videoCache.cache.size
    }
  });
});

// ============================================================================
// ADMIN & DOCUMENTATION
// ============================================================================

app.get('/docs', (req, res) => res.render('docs'));

app.get('/admin', auth, (req, res) => {
  res.render('admin', { 
    apiKey: process.env.API_KEY_MAIN,
    stats: {
      uptime: Math.floor(process.uptime()),
      cacheSize: {
        search: searchCache.cache.size,
        video: videoCache.cache.size
      },
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development'
    }
  });
});

app.post('/admin/cache/clear', auth, (req, res) => {
  searchCache.clear();
  videoCache.clear();
  log('info', 'Cache cleared by admin');
  res.json({ success: true, message: 'Cache cleared successfully' });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested resource does not exist',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  log('error', 'Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ============================================================================
// SERVER START
// ============================================================================

app.listen(PORT, () => {
  log('info', `Server started on port ${PORT}`, {
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version
  });
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📚 API Docs: http://localhost:${PORT}/docs`);
  console.log(`🔐 Admin Panel: http://localhost:${PORT}/admin`);
});
