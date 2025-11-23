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
  secret: process.env.SESSION_SECRET || 'change_this_in_production',
  resave: false,
  saveUninitialized: false
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Login routes
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  if (req.body.username === process.env.USERNAME && req.body.password === process.env.PASSWORD) {
    req.session.authenticated = true;
    return res.redirect('/admin');
  }
  res.render('login', { error: 'Wrong username or password' });
});

const requireAuth = (req, res, next) => req.session.authenticated ? next() : res.redirect('/login');

const requireApiKey = (req, res, next) => {
  const key = req.query.key || req.headers['x-api-key'];
  if (key === process.env.API_KEY_MAIN || req.path === '/login' || req.path === '/docs') return next();
  return res.status(401).json({ error: 'API key required' });
};

// Routes
app.get('/', (req, res) => res.redirect('/search'));

app.get('/search', requireApiKey, async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.render('search', { results: [], query: '' });

  try {
    const { data } = await axios.get(`https://www.xvideos.com/?k=${encodeURIComponent(q)}`, { timeout: 10000 });
    const $ = cheerio.load(data);

    const results = [];
    $('div.thumb-block').each((i, el) => {
      const title = $(el).find('p.title a').text().trim();
      const href = $(el).find('p.title a').attr('href');
      const thumb = \( (el).find('img.thumb').attr('data-src') || \)(el).find('img').attr('src') || '';
      const duration = $(el).find('span.duration').text().trim();

      if (href && href.startsWith('/video')) {
        const id = href.split('/')[2].split(/[/?#]/)[0];
        results.push({
          id,
          title,
          thumb: thumb.replace('thumbs/', 'thumbsxl/').replace('th_', ''),
          duration,
          url: `https://www.xvideos.com${href}`
        });
      }
    });

    if (req.query.format === 'json' || req.headers.accept?.includes('application/json')) {
      return res.json({ query: q, results });
    }
    res.render('search', { results, query: q });
  } catch (err) {
    res.status(500).send('Search failed — try again');
  }
});

app.get('/video', requireApiKey, async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'id required' });

  try {
    const { data } = await axios.get(`https://www.xvideos.com/video${id}/`, { timeout: 15000 });
    const $ = cheerio.load(data);

    const title = \( ('meta[property="og:title"]').attr('content') || \)('h2.page-title').text().trim();
    const thumb = ($('meta[property="og:image"]').attr('content') || '').replace('thumbs/', 'thumbsxl/');
    const duration = $('span.duration').first().text().trim();
    const embed = `https://www.xvideos.com/embedframe/${id}`;

    let downloadUrl = '';
    const high = data.match(/setVideoUrlHigh\('([^']+)'\)/);
    const low = data.match(/setVideoUrlLow\('([^']+)'\)/);
    downloadUrl = high ? high[1] : (low ? low[1] : null);

    const videoData = { id, title, thumb, duration, embed, downloadUrl };

    if (req.query.format === 'json' || req.headers.accept?.includes('application/json')) {
      return res.json(videoData);
    }
    res.render('video', videoData);
  } catch (err) {
    res.status(500).send('Video fetch failed');
  }
});

app.get('/download', requireApiKey, (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');
  res.redirect(url);
});

app.get('/docs', (req, res) => res.render('docs'));
app.get('/admin', requireAuth, (req, res) => res.render('admin', { apiKey: process.env.API_KEY_MAIN }));

app.listen(PORT, () => console.log(`Running → https://your-app.onrender.com`));
