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
    
    console.log('[SEARCH] Fetching:', url);
    const { data } = await http.get(url);
    const $ = cheerio.load(data);
    
    const videos = [];
    
    // Try multiple selectors for xvideos.com
    const videoBlocks = $('div.thumb-block');
    console.log('[SEARCH] Found', videoBlocks.length, 'video blocks');
    
    videoBlocks.each((i, elem) => {
      try {
        const $block = $(elem);
        
        // Get all links in the block
        const $titleLink = $block.find('p.title a');
        const href = $titleLink.attr('href');
        const title = $titleLink.attr('title') || $titleLink.text().trim();
        
        console.log('[SEARCH] Processing:', { href, title: title.substring(0, 50) });
        
        // Extract video ID from URL - xvideos now uses /video.XXXXX/title format
        if (!href) {
          console.log('[SEARCH] No href found');
          return;
        }
        
        // Try new format: /video.otbadvv7045/title
        let videoId = null;
        let idMatch = href.match(/\/video\.([a-z0-9]+)\//);
        if (idMatch) {
          videoId = idMatch[1];
        } else {
          // Try old format: /video12345678/title
          idMatch = href.match(/\/video(\d+)\//);
          if (idMatch) {
            videoId = idMatch[1];
          }
        }
        
        if (!videoId) {
          console.log('[SEARCH] No ID match for:', href);
          return;
        }
        
        // Get thumbnail - try multiple attributes
        const $img = $block.find('img');
        let thumb = $img.attr('data-src') || $img.attr('src') || $img.attr('data-thumb_url') || '';
        
        // Get duration
        const duration = $block.find('span.duration').text().trim() || 
                        $block.find('.duration').text().trim() || '';
        
        console.log('[SEARCH] Added video:', { id: videoId, title: title.substring(0, 30), duration });
        
        videos.push({
          id: videoId,
          title: title,
          duration: duration,
          thumbnail: thumb,
          url: `https://www.xvideos.com${href}`,
          fullPath: href  // Store the full path for later use
        });
      } catch (err) {
        console.error('[SEARCH] Parse error:', err.message);
      }
    });
    
    const result = { query, page, videos, count: videos.length };
    setCache(cacheKey, result);
    console.log('[SEARCH] Total found:', videos.length, 'videos');
    return result;
    
  } catch (error) {
    console.error('[SEARCH] Request error:', error.message);
    throw new Error('Search failed: ' + error.message);
  }
}

async function getVideoDownloadUrl(videoId, fullPath = null) {
  const cacheKey = `video:${videoId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    // Construct URL - use fullPath if provided, otherwise try to construct
    let url;
    if (fullPath) {
      // Use the full path from search results
      url = `https://www.xvideos.com${fullPath}`;
    } else if (/^\d+$/.test(videoId)) {
      // Old format: numeric ID
      url = `https://www.xvideos.com/video${videoId}/`;
    } else {
      // New format: try basic construction (may fail without title slug)
      url = `https://www.xvideos.com/video.${videoId}/`;
    }
    
    console.log('[VIDEO] Fetching:', url);
    
    const { data, status } = await http.get(url);
    console.log('[VIDEO] Response status:', status);
    console.log('[VIDEO] Response length:', data.length);
    
    const $ = cheerio.load(data);
    
    // Extract title
    const title = $('meta[property="og:title"]').attr('content') || 
                  $('h2.page-title').text().trim() ||
                  $('.title-text').text().trim() ||
                  'Video';
    
    console.log('[VIDEO] Title:', title);
    
    // Extract thumbnail
    const thumbnail = $('meta[property="og:image"]').attr('content') || '';
    
    // Extract duration
    const duration = $('.duration').first().text().trim() || 
                     $('meta[property="video:duration"]').attr('content') || '';
    
    console.log('[VIDEO] Duration:', duration);
    
    // Extract download URL - MULTIPLE METHODS WITH LOGGING
    let downloadUrl = null;
    
    // Method 1: html5player.setVideoUrlHigh
    let match = data.match(/html5player\.setVideoUrlHigh\('([^']+)'\)/);
    if (match && match[1]) {
      downloadUrl = match[1];
      console.log('[VIDEO] ✓ Found via setVideoUrlHigh');
    }
    
    // Method 2: html5player.setVideoUrlLow
    if (!downloadUrl) {
      match = data.match(/html5player\.setVideoUrlLow\('([^']+)'\)/);
      if (match && match[1]) {
        downloadUrl = match[1];
        console.log('[VIDEO] ✓ Found via setVideoUrlLow');
      }
    }
    
    // Method 3: setVideoUrlHigh (without html5player prefix)
    if (!downloadUrl) {
      match = data.match(/setVideoUrlHigh\('([^']+)'\)/);
      if (match && match[1]) {
        downloadUrl = match[1];
        console.log('[VIDEO] ✓ Found via setVideoUrlHigh (no prefix)');
      }
    }
    
    // Method 4: setVideoUrlLow (without html5player prefix)
    if (!downloadUrl) {
      match = data.match(/setVideoUrlLow\('([^']+)'\)/);
      if (match && match[1]) {
        downloadUrl = match[1];
        console.log('[VIDEO] ✓ Found via setVideoUrlLow (no prefix)');
      }
    }
    
    // Method 5: Check for HLS stream
    if (!downloadUrl) {
      match = data.match(/html5player\.setVideoHLS\('([^']+)'\)/);
      if (match && match[1]) {
        downloadUrl = match[1];
        console.log('[VIDEO] ✓ Found via HLS');
      }
    }
    
    // Method 6: Look for any video URLs in data
    if (!downloadUrl) {
      match = data.match(/https?:\/\/[^'"]+\.mp4[^'"']*/);
      if (match) {
        downloadUrl = match[0];
        console.log('[VIDEO] ✓ Found via generic mp4 search');
      }
    }
    
    // Method 7: Look in JSON data structures
    if (!downloadUrl) {
      const jsonMatch = data.match(/html5player\.set[^{]*(\{[^}]+videoUrl[^}]+\})/);
      if (jsonMatch) {
        console.log('[VIDEO] Found JSON config:', jsonMatch[1].substring(0, 200));
        const urlMatch = jsonMatch[1].match(/"([^"]*\.mp4[^"]*)"/);
        if (urlMatch) {
          downloadUrl = urlMatch[1];
          console.log('[VIDEO] ✓ Found via JSON config');
        }
      }
    }
    
    console.log('[VIDEO] Final downloadUrl:', downloadUrl ? 'FOUND' : 'NOT FOUND');
    
    const result = {
      id: videoId,
      title,
      duration,
      thumbnail,
      downloadUrl,
      embedUrl: /^\d+$/.test(videoId) 
        ? `https://www.xvideos.com/embedframe/${videoId}`
        : `https://www.xvideos.com/embedframe.${videoId}`,
      pageUrl: url
    };
    
    setCache(cacheKey, result);
    console.log('[VIDEO] Download URL found:', !!downloadUrl);
    return result;
    
  } catch (error) {
    console.error('[VIDEO] Error:', error.message);
    console.error('[VIDEO] Stack:', error.stack);
    throw new Error('Failed to get video: ' + error.message);
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

// DEBUG endpoint - remove after testing
app.get('/api/debug/search', authApi, async (req, res) => {
  try {
    const query = req.query.q || 'test';
    const url = `https://www.xvideos.com/?k=${encodeURIComponent(query)}`;
    
    const { data } = await http.get(url);
    const $ = cheerio.load(data);
    
    // Get sample of what we find
    const blocks = $('div.thumb-block');
    const sample = [];
    
    blocks.slice(0, 3).each((i, elem) => {
      const $block = $(elem);
      sample.push({
        html: $block.html().substring(0, 500),
        titleLink: {
          href: $block.find('p.title a').attr('href'),
          title: $block.find('p.title a').text().trim(),
          titleAttr: $block.find('p.title a').attr('title')
        },
        allLinks: $block.find('a').map((i, el) => $(el).attr('href')).get(),
        duration: $block.find('span.duration').text().trim()
      });
    });
    
    res.json({
      url,
      totalBlocks: blocks.length,
      sample
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DEBUG video page
app.get('/api/debug/video/:id', authApi, async (req, res) => {
  try {
    const videoId = req.params.id;
    let url;
    if (/^\d+$/.test(videoId)) {
      url = `https://www.xvideos.com/video${videoId}/`;
    } else {
      url = `https://www.xvideos.com/video.${videoId}/`;
    }
    
    const { data } = await http.get(url);
    
    // Look for all potential video URL patterns
    const patterns = {
      setVideoUrlHigh: data.match(/html5player\.setVideoUrlHigh\('([^']+)'\)/),
      setVideoUrlLow: data.match(/html5player\.setVideoUrlLow\('([^']+)'\)/),
      setVideoHLS: data.match(/html5player\.setVideoHLS\('([^']+)'\)/),
      anyMp4: data.match(/https?:\/\/[^'"]+\.mp4[^'"]*/g),
      setVideoUrl: data.match(/setVideoUrl[^(]*\('([^']+)'\)/g)
    };
    
    res.json({
      url,
      videoId,
      patterns,
      htmlSample: data.substring(0, 2000)
    });
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
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
