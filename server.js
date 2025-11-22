require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const cheerio = require('cheerio');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'default_secret_change_me',
  resave: false,
  saveUninitialized: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Auth Middleware for admin
const auth = (req, res, next) => {
  if (req.session.authenticated) return next();
  res.redirect('/login');
};

// Login routes
app.get('/login', (req, res) => res.render('login'));
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.USERNAME && password === process.env.PASSWORD) {
    req.session.authenticated = true;
    return res.redirect('/admin');
  }
  res.render('login', { error: 'Invalid credentials' });
});

// API Key check for endpoints
const apiKeyCheck = (req, res, next) => {
  const key = req.query.key || req.headers['x-api-key'];
  if (key === process.env.API_KEY_MAIN) return next();
  if (['/admin', '/login', '/docs'].includes(req.path)) return next();
  res.status(401).json({ error: 'Invalid or missing API key' });
};

// Home / Search
app.get('/', (req, res) => res.redirect('/search'));
app.get('/search', apiKeyCheck, async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.render('search', { results: [], query: '' });

  try {
    const searchUrl = `https://www.xvideos.com/?k=${encodeURIComponent(q)}`;
    const { data } = await axios.get(searchUrl, { timeout: 10000 });
    const $ = cheerio.load(data);

    const results = [];
    $('div.thumb-block').each((i, el) => {
      const title = $(el).find('p.title a').text().trim();
      const link = $(el).find('p.title a').attr('href');
      const thumb = \( (el).find('img.thumb').attr('data-src') || \)(el).find('img').attr('src');
      const duration = $(el).find('span.duration').text().trim();
      if (link && link.startsWith('/video')) {
        const id = link.split('/')[2].replace(/\D/g, ''); // Clean ID
        results.push({ id, title, thumb: thumb?.replace('thumbs/', 'thumbsxl/') || '', duration, url: `https://www.xvideos.com${link}` });
      }
    });

    if (req.headers.accept?.includes('application/json') || req.query.format === 'json') {
      return res.json({ query: q, results });
    }
    res.render('search', { results, query: q });
  } catch (e) {
    res.status(500).json({ error: 'Search failed', details: e.message });
  }
});

// Single Video + Direct Download Link
app.get('/video', apiKeyCheck, async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  try {
    const pageUrl = `https://www.xvideos.com/video${id}/a`; // Placeholder to load
    const { data } = await axios.get(pageUrl, { timeout: 15000 });
    const $ = cheerio.load(data);

    const title = \( ('meta[property="og:title"]').attr('content') || \)('h2.page-title').text().trim();
    const thumb = $('meta[property="og:image"]').attr('content')?.replace('thumbs/', 'thumbsxl/') || '';
    const duration = $('span.duration').first().text().trim();
    const embed = `https://www.xvideos.com/embedframe/${id}`;

    // Direct MP4 extraction (2025 reliable)
    let downloadUrl = '';
    const highMatch = data.match(/html5player\.setVideoUrlHigh\('([^']+)'\)/);
    if (highMatch) downloadUrl = highMatch[1];
    if (!downloadUrl) {
      const lowMatch = data.match(/html5player\.setVideoUrlLow\('([^']+)'\)/);
      if (lowMatch) downloadUrl = lowMatch[1];
    }

    const videoData = {
      id,
      title,
      thumb,
      duration,
      embed,
      page: pageUrl,
      downloadUrl: downloadUrl || null
    };

    if (req.query.format === 'json' || req.headers.accept?.includes('application/json')) {
      return res.json(videoData);
    }
    res.render('video', videoData);
  } catch (e) {
    res.status(500).json({ error: 'Video fetch failed', details: e.message });
  }
});

// Download redirect
app.get('/download', apiKeyCheck, (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('No URL');
  res.redirect(url);
});

// Docs
app.get('/docs', (req, res) => res.render('docs'));

// Admin
app.get('/admin', auth, (req, res) => {
  res.render('admin', { apiKey: process.env.API_KEY_MAIN || 'Not set' });
});

app.listen(PORT, () => console.log(`Running on port ${PORT}`));
