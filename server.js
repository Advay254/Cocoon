require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const cheerio = require('cheerio');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'xvideos-downloader-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(rateLimit({ windowMs: 15*60*1000, max: 200 }));

// Cache
const cache = new Map();
function getCached(key) {
  const item = cache.get(key);
  if (!item || Date.now() > item.exp) { cache.delete(key); return null; }
  return item.data;
}
function setCache(key, data, ttl = 300000) {
  cache.set(key, { data, exp: Date.now() + ttl });
}

// Auth Middleware
const authWeb = (req, res, next) => {
  if (req.session.loggedIn) return next();
  res.redirect('/login');
};

const authApi = (req, res, next) => {
  const key = req.query.key || req.headers['x-api-key'];
  if (key === process.env.API_KEY) return next();
  res.status(401).json({ error: 'Invalid API key' });
};

// Axios with proper headers
const http = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  }
});

// ============================================================================
// CORE XVIDEOS.COM SCRAPER - PRODUCTION READY
// ============================================================================

async function searchXVideos(query, page = 0) {
  const cacheKey = `search:${query}:${page}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url = page > 0 
      ? `https://www.xvideos.com/?k=${encodeURIComponent(query)}&p=${page}`
      : `https://www.xvideos.com/?k=${encodeURIComponent(query)}`;
    
    console.log('[SEARCH]', url);
    const { data } = await http.get(url);
    const $ = cheerio.load(data);
    
    const videos = [];
    
    $('#content .mozaique .thumb-block').each((i, elem) => {
      try {
        const $block = $(elem);
        
        // Get video link
        const $link = $block.find('.thumb-under .title a').first();
        const href = $link.attr('href');
        const title = $link.attr('title') || $link.text().trim();
        
        // Extract video ID from URL like /video73562167/title
        const idMatch = href ? href.match(/\/video(\d+)\//) : null;
        if (!idMatch) return;
        
        const videoId = idMatch[1];
        
        // Get thumbnail
        const $img = $block.find('.thumb img');
        let thumb = $img.attr('data-src') || $img.attr('src') || '';
        
        // Get duration
        const duration = $block.find('.duration').text().trim() || '';
        
        videos.push({
          id: videoId,
          title: title,
          duration: duration,
          thumbnail: thumb,
          url: `https://www.xvideos.com${href}`
        });
      } catch (err) {
        console.error('[SEARCH] Parse error:', err.message);
      }
    });
    
    const result = { query, page, videos, count: videos.length };
    setCache(cacheKey, result);
    console.log('[SEARCH] Found', videos.length, 'videos');
    return result;
    
  } catch (error) {
    console.error('[SEARCH] Error:', error.message);
    throw new Error('Search failed');
  }
}

async function getVideoDownloadUrl(videoId) {
  const cacheKey = `video:${videoId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://www.xvideos.com/video${videoId}/`;
    console.log('[VIDEO]', url);
    
    const { data } = await http.get(url);
    const $ = cheerio.load(data);
    
    // Extract title
    const title = $('meta[property="og:title"]').attr('content') || 
                  $('h2.page-title').text().trim() ||
                  $('.title-text').text().trim() ||
                  'Video';
    
    // Extract thumbnail
    const thumbnail = $('meta[property="og:image"]').attr('content') || '';
    
    // Extract duration
    const duration = $('.duration').first().text().trim() || 
                     $('meta[property="video:duration"]').attr('content') || '';
    
    // Extract download URL - MULTIPLE METHODS
    let downloadUrl = null;
    
    // Method 1: html5player.setVideoUrlHigh
    let match = data.match(/html5player\.setVideoUrlHigh\('([^']+)'\)/);
    if (match && match[1]) {
      downloadUrl = match[1];
      console.log('[VIDEO] Found HIGH quality URL');
    }
    
    // Method 2: html5player.setVideoUrlLow
    if (!downloadUrl) {
      match = data.match(/html5player\.setVideoUrlLow\('([^']+)'\)/);
      if (match && match[1]) {
        downloadUrl = match[1];
        console.log('[VIDEO] Found LOW quality URL');
      }
    }
    
    // Method 3: setVideoUrlHigh (without html5player prefix)
    if (!downloadUrl) {
      match = data.match(/setVideoUrlHigh\('([^']+)'\)/);
      if (match && match[1]) downloadUrl = match[1];
    }
    
    // Method 4: setVideoUrlLow (without html5player prefix)
    if (!downloadUrl) {
      match = data.match(/setVideoUrlLow\('([^']+)'\)/);
      if (match && match[1]) downloadUrl = match[1];
    }
    
    // Method 5: Check for HLS stream
    if (!downloadUrl) {
      match = data.match(/html5player\.setVideoHLS\('([^']+)'\)/);
      if (match && match[1]) {
        downloadUrl = match[1];
        console.log('[VIDEO] Found HLS stream');
      }
    }
    
    // Method 6: Look in window objects
    if (!downloadUrl) {
      match = data.match(/setVideo[Uu]rl[HL][io][gw][hd]?\('([^']+)'\)/);
      if (match && match[1]) downloadUrl = match[1];
    }
    
    const result = {
      id: videoId,
      title,
      duration,
      thumbnail,
      downloadUrl,
      embedUrl: `https://www.xvideos.com/embedframe/${videoId}`,
      pageUrl: url
    };
    
    setCache(cacheKey, result);
    console.log('[VIDEO] Download URL found:', !!downloadUrl);
    return result;
    
  } catch (error) {
    console.error('[VIDEO] Error:', error.message);
    throw new Error('Failed to get video');
  }
}

// ============================================================================
// WEB ROUTES
// ============================================================================

app.get('/login', (req, res) => {
  if (req.session.loggedIn) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    req.session.username = username;
    return res.redirect('/');
  }
  res.render('login', { error: 'Invalid username or password' });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/', authWeb, (req, res) => {
  res.render('home', { username: req.session.username });
});

app.post('/search', authWeb, async (req, res) => {
  try {
    const query = req.body.query?.trim();
    if (!query) {
      return res.render('results', { videos: [], query: '', error: 'Enter search term' });
    }
    
    const result = await searchXVideos(query);
    res.render('results', { 
      videos: result.videos, 
      query: result.query, 
      error: null 
    });
  } catch (error) {
    res.render('results', { 
      videos: [], 
      query: req.body.query || '', 
      error: 'Search failed. Try again.' 
    });
  }
});

app.get('/video/:id', authWeb, async (req, res) => {
  try {
    const video = await getVideoDownloadUrl(req.params.id);
    res.render('video', { video, error: null });
  } catch (error) {
    res.render('video', { video: null, error: 'Failed to load video' });
  }
});

// ============================================================================
// API ROUTES
// ============================================================================

app.get('/api/search', authApi, async (req, res) => {
  try {
    const query = req.query.q?.trim();
    if (!query) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing query parameter "q"' 
      });
    }
    
    const page = parseInt(req.query.page) || 0;
    const result = await searchXVideos(query, page);
    
    res.json({
      success: true,
      query: result.query,
      page: result.page,
      count: result.count,
      videos: result.videos
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/video/:id', authApi, async (req, res) => {
  try {
    const video = await getVideoDownloadUrl(req.params.id);
    res.json({
      success: true,
      video: video
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/download/:id', authApi, async (req, res) => {
  try {
    const video = await getVideoDownloadUrl(req.params.id);
    if (!video.downloadUrl) {
      return res.status(404).json({ 
        success: false, 
        error: 'Download URL not available' 
      });
    }
    res.redirect(video.downloadUrl);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    cache: cache.size,
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((req, res) => {
  res.status(404).send('Page not found');
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).send('Something went wrong');
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🚀 XVideos Downloader - PRODUCTION');
  console.log('='.repeat(50));
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`🔐 Login: http://localhost:${PORT}/login`);
  console.log(`🔌 API: http://localhost:${PORT}/api`);
  console.log('='.repeat(50));
});
