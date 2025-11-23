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
  secret: process.env.SESSION_SECRET || 'change_me_please',
  resave: false,
  saveUninitialized: false
}));

app.use(rateLimit({ windowMs: 15*60*1000, max: 100 }));

// Login
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  if (req.body.username === process.env.USERNAME && req.body.password === process.env.PASSWORD) {
    req.session.authenticated = true;
    return res.redirect('/admin');
  }
  res.render('login', { error: 'Wrong credentials' });
});

const auth = (req, res, next) => req.session.authenticated ? next() : res.redirect('/login');
const apiKey = (req, res, next) => {
  const key = req.query.key || req.headers['x-api-key'];
  if (key === process.env.API_KEY_MAIN || ['/login','/docs'].includes(req.path)) return next();
  return res.status(401).json({error:'API key required'});
};

// Routes
app.get('/', (req, res) => res.redirect('/search'));

app.get('/search', apiKey, async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.render('search', { results: [], query: '' });

  try {
    const { data } = await axios.get(`https://www.xvideos.com/?k=${encodeURIComponent(q)}`);
    const $ = cheerio.load(data);
    const results = [];

    $('div.thumb-block').each((i, el) => {
      const title = $(el).find('p.title a').text().trim();
      const href = $(el).find('p.title a').attr('href');
      const thumb = $(el).find('img.thumb').attr('data-src') || $(el).find('img').attr('src') || '';
      const duration = $(el).find('span.duration').text().trim();
      if (href?.startsWith('/video')) {
        const id = href.split('/')[2].split(/[/?#]/)[0];
        results.push({
          id,
          title,
          thumb: thumb.replace('thumbs/', 'thumbsxl/'),
          duration
        });
      }
    });

    if (req.query.format === 'json') return res.json(results);
    res.render('search', { results, query: q });
  } catch (e) {
    res.status(500).send('Search error');
  }
});

app.get('/video', apiKey, async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({error:'no id'});

  try {
    const { data } = await axios.get(`https://www.xvideos.com/video${id}/`);
    const $ = cheerio.load(data);

    const title = $('meta[property="og:title"]').attr('content') || '';
    const thumb = ($('meta[property="og:image"]').attr('content') || '').replace('thumbs/', 'thumbsxl/');
    const duration = $('span.duration').first().text().trim();
    const embed = `https://www.xvideos.com/embedframe/${id}`;

    let downloadUrl = null;
    const high = data.match(/setVideoUrlHigh\('([^']+)'\)/);
    const low = data.match(/setVideoUrlLow\('([^']+)'\)/);
    downloadUrl = high ? high[1] : (low ? low[1] : null);

    const out = { id, title, thumb, duration, embed, downloadUrl };

    if (req.query.format === 'json') return res.json(out);
    res.render('video', out);
  } catch (e) {
    res.status(500).send('Video error');
  }
});

app.get('/download', apiKey, (req, res) => res.redirect(req.query.url || '/'));

app.get('/docs', (req, res) => res.render('docs'));
app.get('/admin', auth, (req, res) => res.render('admin', { apiKey: process.env.API_KEY_MAIN }));

app.listen(PORT, () => console.log(`LIVE on port ${PORT}`));
