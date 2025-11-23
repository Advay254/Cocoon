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

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(compression());
app.use(morgan('combined'));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change_me_please',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}));

// ============================================================================
// CACHE
// ============================================================================

class SimpleCache {
  constructor(ttl = 300000) {
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

const searchCache = new SimpleCache(300000);
const videoCache = new SimpleCache(600000);

// ============================================================================
// AXIOS SETUP
// ============================================================================

const axiosInstance = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
});

// Retry logic
axiosInstance.interceptors.response.use(null, async (error) => {
  const config = error.config;
  if (!config || !config.retry) config.retry = 0;
  if (config.retry >= 3) return Promise.reject(error);
  config.retry += 1;
  await new Promise(resolve => setTimeout(resolve, 1000 * config.retry));
  return axiosInstance(config);
});

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...data }));
}

function sanitizeInput(input) {
  if (!input) return '';
  return input.toString().trim().replace(/[<>]/g, '');
}

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

const auth = (req, res, next) => {
  if (req.session.authenticated) return next();
  res.redirect('/login');
};

const apiKey = (req, res, next) => {
  const publicRoutes = ['/login', '/logout', '/docs', '/', '/api/v1/health'];
  if (publicRoutes.includes(req.path)) return next();
  
  const key = req.query.key || req.headers['x-api-key'];
  
  if (key === process.env.API_KEY_MAIN) {
    req.apiKeyValid = true;
    return next();
  }
  
  return res.status(401).json({ 
    error: 'API key required',
    message: 'Provide API key via ?key=YOUR_KEY or x-api-key header'
  });
};

// ============================================================================
// LOGIN ROUTES
// ============================================================================

app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/admin');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === process.env.USERNAME && password === process.env.PASSWORD) {
    req.session.authenticated = true;
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

// ============================================================================
// SCRAPING FUNCTIONS - FIXED
// ============================================================================

function extractVideoId(href) {
  // href format: /video12345678/title or /video.12345678/title
  if (!href) return null;
  
  const match = href.match(/\/video\.?(\d+)\//);
  if (match && match[1]) {
    return match[1];
  }
  
  // Fallback: try to extract any number after /video
  const fallback = href.match(/\/video\.?(\d+)/);
  return fallback ? fallback[1] : null;
}

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
      const $el = $(el);
      const $titleLink = $el.find('p.title a');
      
      const title = $titleLink.attr('title') || $titleLink.text().trim();
      const href = $titleLink.attr('href');
      const duration = $el.find('span.duration').text().trim();
      
      const videoId = extractVideoId(href);
      
      if (videoId) {
        results.push({
          title: title,
          duration: duration,
          videoId: videoId
        });
      }
    });

    const response = {
      query,
      page,
      results,
      count: results.length
    };

    searchCache.set(cacheKey, response);
    log('info', 'Search completed', { query, page, count: results.length });
    
    return response;
  } catch (error) {
    log('error', 'Search failed', { query, page, error: error.message });
    throw error;
  }
}

async function getVideoDownloadUrl(videoId) {
  const cacheKey = `video:${videoId}`;
  const cached = videoCache.get(cacheKey);
  if (cached) {
    log('info', 'Cache hit for video', { videoId });
    return cached;
  }

  try {
    const url = `https://www.xvideos.com/video${videoId}/`;
    const { data } = await axiosInstance.get(url);
    const $ = cheerio.load(data);

    const title = $('meta[property="og:title"]').attr('content') || 
                  $('h2.page-title').text().trim() ||
                  'Unknown Title';
    
    const duration = $('span.duration').first().text().trim() || 'Unknown';

    // Extract download URL - try multiple methods
    let downloadUrl = null;
    
    // Method 1: setVideoUrlHigh
    const highMatch = data.match(/setVideoUrlHigh\('([^']+)'\)/);
    if (highMatch && highMatch[1]) {
      downloadUrl = highMatch[1];
    }
    
    // Method 2: setVideoUrlLow
    if (!downloadUrl) {
      const lowMatch = data.match(/setVideoUrlLow\('([^']+)'\)/);
      if (lowMatch && lowMatch[1]) {
        downloadUrl = lowMatch[1];
      }
    }
    
    // Method 3: html5player.setVideoHLS
    if (!downloadUrl) {
      const hlsMatch = data.match(/html5player\.setVideoHLS\('([^']+)'\)/);
      if (hlsMatch && hlsMatch[1]) {
        downloadUrl = hlsMatch[1];
      }
    }

    // Method 4: Look in JSON data
    if (!downloadUrl) {
      const jsonMatch = data.match(/html5player\.setVideoUrlHigh\('([^']+)'\)/);
      if (jsonMatch && jsonMatch[1]) {
        downloadUrl = jsonMatch[1];
      }
    }

    const response = {
      title,
      duration,
      downloadUrl: downloadUrl || null
    };

    videoCache.set(cacheKey, response);
    log('info', 'Video scraped', { videoId, hasDownloadUrl: !!downloadUrl });
    
    return response;
  } catch (error) {
    log('error', 'Video scraping failed', { videoId, error: error.message });
    throw error;
  }
}

async function getTrending() {
  const cacheKey = 'trending';
  const cached = searchCache.get(cacheKey);
  if (cached) {
    log('info', 'Cache hit for trending');
    return cached;
  }

  try {
    const { data } = await axiosInstance.get('https://www.xvideos.com/');
    const $ = cheerio.load(data);
    const trending = [];

    $('div.thumb-block').slice(0, 20).each((i, el) => {
      const $el = $(el);
      const $titleLink = $el.find('p.title a');
      
      const title = $titleLink.attr('title') || $titleLink.text().trim();
      const href = $titleLink.attr('href');
      const duration = $el.find('span.duration').text().trim();
      
      const videoId = extractVideoId(href);
      
      if (videoId) {
        trending.push({
          title: title,
          duration: duration,
          videoId: videoId
        });
      }
    });

    const response = {
      trending,
      count: trending.length
    };

    searchCache.set(cacheKey, response);
    log('info', 'Trending fetched', { count: trending.length });
    
    return response;
  } catch (error) {
    log('error', 'Trending fetch failed', { error: error.message });
    throw error;
  }
}

// ============================================================================
// WEB ROUTES (UI)
// ============================================================================

app.get('/', (req, res) => {
  if (req.session.authenticated) {
    return res.redirect('/search');
  }
  res.redirect('/login');
});

app.get('/search', auth, async (req, res) => {
  const q = sanitizeInput(req.query.q);
  const page = parseInt(req.query.page) || 1;
  
  if (!q) return res.render('search', { results: [], query: '', page: 1 });

  try {
    const data = await scrapeSearch(q, page);
    res.render('search', { 
      results: data.results, 
      query: q,
      page: data.page
    });
  } catch (error) {
    log('error', 'Search route error', { query: q, error: error.message });
    res.status(500).send('Search error. Please try again later.');
  }
});

app.get('/video', auth, async (req, res) => {
  const videoId = sanitizeInput(req.query.id);
  
  if (!videoId) return res.status(400).send('No video ID provided');

  try {
    const video = await getVideoDownloadUrl(videoId);
    res.render('video', {
      id: videoId,
      title: video.title,
      duration: video.duration,
      downloadUrl: video.downloadUrl,
      thumb: `https://img-hw.xvideos-cdn.com/videos/thumbs169ll/${videoId}/1.jpg`,
      embed: `https://www.xvideos.com/embedframe/${videoId}`
    });
  } catch (error) {
    log('error', 'Video route error', { videoId, error: error.message });
    res.status(500).send('Video error. Please try again later.');
  }
});

app.get('/docs', auth, (req, res) => res.render('docs'));

app.get('/admin', auth, (req, res) => {
  res.render('admin', { 
    apiKey: process.env.API_KEY_MAIN,
    stats: {
      uptime: Math.floor(process.uptime()),
      cacheSize: {
        search: searchCache.cache.size,
        video: videoCache.cache.size
      }
    }
  });
});

app.post('/admin/cache/clear', auth, (req, res) => {
  searchCache.clear();
  videoCache.clear();
  log('info', 'Cache cleared');
  res.json({ success: true, message: 'Cache cleared' });
});

// ============================================================================
// API ROUTES (JSON)
// ============================================================================

app.get('/api/v1/search', apiKey, async (req, res) => {
  try {
    const q = sanitizeInput(req.query.q);
    const page = parseInt(req.query.page) || 1;
    
    if (!q) {
      return res.status(400).json({ 
        success: false,
        error: 'Query parameter required',
        usage: 'GET /api/v1/search?key=YOUR_KEY&q=searchterm'
      });
    }
    
    const data = await scrapeSearch(q, page);
    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message
    });
  }
});

app.get('/api/v1/video/:videoId', apiKey, async (req, res) => {
  try {
    const videoId = sanitizeInput(req.params.videoId);
    const video = await getVideoDownloadUrl(videoId);
    
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

app.get('/api/v1/download/:videoId', apiKey, async (req, res) => {
  try {
    const videoId = sanitizeInput(req.params.videoId);
    const video = await getVideoDownloadUrl(videoId);
    
    if (!video.downloadUrl) {
      return res.status(404).json({
        success: false,
        error: 'Download URL not available for this video'
      });
    }
    
    res.json({
      success: true,
      data: {
        title: video.title,
        duration: video.duration,
        downloadUrl: video.downloadUrl
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch download URL',
      message: error.message
    });
  }
});

app.get('/api/v1/trending', apiKey, async (req, res) => {
  try {
    const data = await getTrending();
    res.json({
      success: true,
      data: data
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
// DOWNLOAD ROUTE
// ============================================================================

app.get('/download', apiKey, async (req, res) => {
  const videoId = req.query.id;
  const url = req.query.url;
  
  if (url) {
    return res.redirect(url);
  }
  
  if (videoId) {
    try {
      const video = await getVideoDownloadUrl(videoId);
      if (video.downloadUrl) {
        return res.redirect(video.downloadUrl);
      }
      return res.status(404).json({ error: 'Download URL not found' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch download URL' });
    }
  }
  
  return res.status(400).json({ 
    error: 'Provide ?id=VIDEO_ID or ?url=DOWNLOAD_URL'
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

app.use((err, req, res, next) => {
  log('error', 'Unhandled error', { error: err.message });
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  log('info', `Server started on port ${PORT}`);
  console.log(`🚀 Server: http://localhost:${PORT}`);
  console.log(`🔐 Login: http://localhost:${PORT}/login`);
  console.log(`📚 Docs: http://localhost:${PORT}/docs`);
});
