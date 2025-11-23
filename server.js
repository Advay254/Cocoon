require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const cheerio = require('cheerio');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// MIDDLEWARE
// ============================================================================

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

const cache = new SimpleCache(300000);

// ============================================================================
// AXIOS
// ============================================================================

const axiosInstance = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});

function log(level, message, data = {}) {
  console.log(`[${level}] ${message}`, data);
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

const auth = (req, res, next) => {
  if (req.session.authenticated) return next();
  res.redirect('/login');
};

const apiKey = (req, res, next) => {
  const publicRoutes = ['/login', '/logout', '/docs', '/api/v1/health'];
  if (publicRoutes.includes(req.path)) return next();
  
  const key = req.query.key || req.headers['x-api-key'];
  
  if (key === process.env.API_KEY_MAIN) {
    return next();
  }
  
  return res.status(401).json({ 
    error: 'API key required'
  });
};

// ============================================================================
// SCRAPING - FIXED
// ============================================================================

function extractVideoId(href) {
  if (!href) return null;
  const match = href.match(/\/video\.?(\d+)\//);
  return match ? match[1] : null;
}

async function scrapeSearch(query, page = 1) {
  const cacheKey = `search:${query}:${page}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = page > 1 
      ? `https://www.xvideos.com/?k=${encodeURIComponent(query)}&p=${page}`
      : `https://www.xvideos.com/?k=${encodeURIComponent(query)}`;
    
    const { data } = await axiosInstance.get(url);
    const $ = cheerio.load(data);
    const results = [];

    $('div.thumb-block').each((i, el) => {
      const $el = $(el);
      const $link = $el.find('p.title a');
      
      const title = $link.attr('title') || $link.text().trim();
      const href = $link.attr('href');
      const duration = $el.find('span.duration').text().trim();
      const videoId = extractVideoId(href);
      
      if (videoId) {
        results.push({
          title,
          duration,
          videoId
        });
      }
    });

    const response = { query, page, results, count: results.length };
    cache.set(cacheKey, response);
    return response;
  } catch (error) {
    log('error', 'Search failed', { error: error.message });
    throw error;
  }
}

async function getVideoInfo(videoId) {
  const cacheKey = `video:${videoId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://www.xvideos.com/video${videoId}/`;
    const { data } = await axiosInstance.get(url);
    const $ = cheerio.load(data);

    const title = $('meta[property="og:title"]').attr('content') || 
                  $('h2.page-title').text().trim() || 'Unknown';
    
    const duration = $('span.duration').first().text().trim() || 'Unknown';

    let downloadUrl = null;
    
    const highMatch = data.match(/setVideoUrlHigh\('([^']+)'\)/);
    if (highMatch) downloadUrl = highMatch[1];
    
    if (!downloadUrl) {
      const lowMatch = data.match(/setVideoUrlLow\('([^']+)'\)/);
      if (lowMatch) downloadUrl = lowMatch[1];
    }

    const response = { title, duration, downloadUrl };
    cache.set(cacheKey, response);
    return response;
  } catch (error) {
    log('error', 'Video fetch failed', { error: error.message });
    throw error;
  }
}

async function getTrending() {
  const cacheKey = 'trending';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await axiosInstance.get('https://www.xvideos.com/');
    const $ = cheerio.load(data);
    const results = [];

    $('div.thumb-block').slice(0, 20).each((i, el) => {
      const $el = $(el);
      const $link = $el.find('p.title a');
      
      const title = $link.attr('title') || $link.text().trim();
      const href = $link.attr('href');
      const duration = $el.find('span.duration').text().trim();
      const videoId = extractVideoId(href);
      
      if (videoId) {
        results.push({ title, duration, videoId });
      }
    });

    const response = { results, count: results.length };
    cache.set(cacheKey, response);
    return response;
  } catch (error) {
    log('error', 'Trending failed', { error: error.message });
    throw error;
  }
}

// ============================================================================
// AUTH ROUTES
// ============================================================================

app.get('/login', (req, res) => {
  try {
    res.render('login', { error: null });
  } catch (error) {
    log('error', 'Login render failed', { error: error.message });
    res.status(500).send('Error loading login page');
  }
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === process.env.USERNAME && password === process.env.PASSWORD) {
    req.session.authenticated = true;
    return res.redirect('/admin');
  }
  
  res.render('login', { error: 'Wrong credentials' });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ============================================================================
// WEB ROUTES
// ============================================================================

app.get('/', (req, res) => res.redirect('/search'));

app.get('/search', apiKey, async (req, res) => {
  const q = (req.query.q || '').trim();
  const page = parseInt(req.query.page) || 1;
  
  if (!q) {
    return res.render('search', { results: [], query: '' });
  }

  try {
    const data = await scrapeSearch(q, page);
    
    if (req.query.format === 'json') {
      return res.json(data);
    }
    
    res.render('search', { 
      results: data.results, 
      query: q
    });
  } catch (error) {
    log('error', 'Search error', { error: error.message });
    res.status(500).send('Search error');
  }
});

app.get('/video', apiKey, async (req, res) => {
  const id = (req.query.id || '').trim();
  
  if (!id) {
    return res.status(400).json({ error: 'No video ID' });
  }

  try {
    const video = await getVideoInfo(id);
    
    if (req.query.format === 'json') {
      return res.json(video);
    }
    
    res.render('video', {
      id,
      title: video.title,
      duration: video.duration,
      downloadUrl: video.downloadUrl,
      thumb: `https://img-hw.xvideos-cdn.com/videos/thumbs169ll/${id}/1.jpg`,
      embed: `https://www.xvideos.com/embedframe/${id}`
    });
  } catch (error) {
    log('error', 'Video error', { error: error.message });
    res.status(500).send('Video error');
  }
});

app.get('/download', apiKey, (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'No URL' });
  res.redirect(url);
});

app.get('/docs', (req, res) => {
  try {
    res.render('docs');
  } catch (error) {
    res.status(500).send('Docs error');
  }
});

app.get('/admin', auth, (req, res) => {
  try {
    res.render('admin', { 
      apiKey: process.env.API_KEY_MAIN 
    });
  } catch (error) {
    res.status(500).send('Admin error');
  }
});

// ============================================================================
// API ROUTES
// ============================================================================

app.get('/api/v1/search', apiKey, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const page = parseInt(req.query.page) || 1;
    
    if (!q) {
      return res.status(400).json({ 
        success: false,
        error: 'Query required'
      });
    }
    
    const data = await scrapeSearch(q, page);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/v1/video/:videoId', apiKey, async (req, res) => {
  try {
    const videoId = req.params.videoId;
    const video = await getVideoInfo(videoId);
    res.json({ success: true, data: video });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/v1/download/:videoId', apiKey, async (req, res) => {
  try {
    const videoId = req.params.videoId;
    const video = await getVideoInfo(videoId);
    
    if (!video.downloadUrl) {
      return res.status(404).json({
        success: false,
        error: 'Download URL not available'
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
      error: error.message
    });
  }
});

app.get('/api/v1/trending', apiKey, async (req, res) => {
  try {
    const data = await getTrending();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    cacheSize: cache.cache.size
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  log('error', 'Unhandled error', { error: err.message });
  res.status(500).json({ error: 'Server error' });
});

// ============================================================================
// START
// ============================================================================

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
