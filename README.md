# Cocoon - Production Ready

Complete XVideos.com downloader with beautiful web interface and REST API for automation.

## ✨ Features

### 🌐 Web Interface
- Secure login system
- Search videos by keywords
- View search results in grid
- Click video to see player + download button
- Direct MP4 download links

### 🔌 REST API
- `/api/search` - Search videos
- `/api/video/:id` - Get video info + download URL
- `/api/download/:id` - Direct download redirect
- `/api/health` - Server health check

## 📁 Complete File Structure

```
xvideos-downloader/
├── server.js              # Main application
├── package.json           # Dependencies
├── .env                   # Environment variables (YOU CREATE THIS)
├── .env.example           # Example environment file
├── .gitignore             # Git ignore rules
├── README.md              # This file
├── views/
│   ├── login.ejs          # Login page
│   ├── home.ejs           # Home/search page
│   ├── results.ejs        # Search results grid
│   └── video.ejs          # Video player + download
└── public/                # Static files folder (CREATE EMPTY)
```

## 🚀 Quick Setup

### 1. Create Project Folder

```bash
mkdir xvideos-downloader
cd xvideos-downloader
```

### 2. Create All Files

Create the following files with content from the artifacts:
- `server.js`
- `package.json`
- `.env.example`
- `.gitignore`
- `README.md`

### 3. Create Views Folder

```bash
mkdir views
```

Then create inside `views/`:
- `login.ejs`
- `home.ejs`
- `results.ejs`
- `video.ejs`

### 4. Create Public Folder

```bash
mkdir public
```

(Leave it empty - it's for static files if needed later)

### 5. Setup Environment Variables

```bash
cp .env.example .env
```

Edit `.env` file:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=MySecurePassword123!
API_KEY=my_secret_api_key_12345
SESSION_SECRET=random_string_at_least_32_characters_long
PORT=3000
```

### 6. Install Dependencies

```bash
npm install
```

### 7. Run Locally

```bash
npm start
```

Visit: `http://localhost:3000`

## 🌐 Deploy to Render

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit - XVideos Downloader"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

### 2. Deploy on Render.com

1. Go to https://render.com and login
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: `xvideos-downloader`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Add Environment Variables:
   - `ADMIN_USERNAME` = your username
   - `ADMIN_PASSWORD` = your password
   - `API_KEY` = your api key
   - `SESSION_SECRET` = random 32+ char string
6. Click "Create Web Service"

## 📖 Usage Guide

### Web Interface

1. **Login**: 
   - Visit your deployed URL (e.g., `https://your-app.onrender.com`)
   - Enter username and password

2. **Search**:
   - Enter keywords in search box
   - Click "Search" button
   - See results in grid

3. **Download**:
   - Click any video card
   - See video player
   - Click "Download Now" button
   - Get direct MP4 file

### API Usage

All API endpoints require API key via `?key=YOUR_KEY` or header `x-api-key: YOUR_KEY`

#### 1. Health Check

```bash
GET /api/health
```

```json
{
  "status": "ok",
  "uptime": 12345,
  "cache": 5,
  "timestamp": "2025-11-23T..."
}
```

#### 2. Search Videos

```bash
GET /api/search?key=YOUR_KEY&q=search_term
```

```json
{
  "success": true,
  "query": "search_term",
  "page": 0,
  "count": 27,
  "videos": [
    {
      "id": "12345678",
      "title": "Video Title",
      "duration": "10:30",
      "thumbnail": "https://...",
      "url": "https://www.xvideos.com/video12345678/..."
    }
  ]
}
```

#### 3. Get Video Info + Download URL

```bash
GET /api/video/:id?key=YOUR_KEY
```

```json
{
  "success": true,
  "video": {
    "id": "12345678",
    "title": "Video Title",
    "duration": "10:30",
    "thumbnail": "https://...",
    "downloadUrl": "https://...video.mp4",
    "embedUrl": "https://www.xvideos.com/embedframe/12345678",
    "pageUrl": "https://www.xvideos.com/video12345678/"
  }
}
```

#### 4. Direct Download (Redirect)

```bash
GET /api/download/:id?key=YOUR_KEY
```

Redirects to the direct MP4 download URL.

## 💻 Code Examples

### JavaScript/Node.js

```javascript
const axios = require('axios');

const API_URL = 'https://your-app.onrender.com';
const API_KEY = 'your_api_key';

// Search videos
async function searchVideos(query) {
  const { data } = await axios.get(`${API_URL}/api/search`, {
    params: { key: API_KEY, q: query }
  });
  return data.videos;
}

// Get download URL
async function getDownloadUrl(videoId) {
  const { data } = await axios.get(`${API_URL}/api/video/${videoId}`, {
    params: { key: API_KEY }
  });
  return data.video.downloadUrl;
}

// Download video to file
async function downloadVideo(videoId, filename) {
  const downloadUrl = await getDownloadUrl(videoId);
  const response = await axios.get(downloadUrl, {
    responseType: 'stream'
  });
  
  const writer = require('fs').createWriteStream(filename);
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// Usage
(async () => {
  const videos = await searchVideos('funny');
  console.log(`Found ${videos.length} videos`);
  
  const videoId = videos[0].id;
  await downloadVideo(videoId, 'video.mp4');
  console.log('Downloaded!');
})();
```

### Python

```python
import requests

API_URL = 'https://your-app.onrender.com'
API_KEY = 'your_api_key'

# Search videos
def search_videos(query):
    response = requests.get(
        f'{API_URL}/api/search',
        params={'key': API_KEY, 'q': query}
    )
    return response.json()['videos']

# Get download URL
def get_download_url(video_id):
    response = requests.get(
        f'{API_URL}/api/video/{video_id}',
        params={'key': API_KEY}
    )
    return response.json()['video']['downloadUrl']

# Download video
def download_video(video_id, filename):
    download_url = get_download_url(video_id)
    response = requests.get(download_url, stream=True)
    
    with open(filename, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)

# Usage
videos = search_videos('funny')
print(f'Found {len(videos)} videos')

video_id = videos[0]['id']
download_video(video_id, 'video.mp4')
print('Downloaded!')
```

### cURL

```bash
# Search
curl "https://your-app.onrender.com/api/search?key=YOUR_KEY&q=funny"

# Get video info
curl "https://your-app.onrender.com/api/video/12345678?key=YOUR_KEY"

# Download video
curl -L -o video.mp4 "https://your-app.onrender.com/api/download/12345678?key=YOUR_KEY"
```

## 🔒 Security Features

- ✅ Session-based authentication for web UI
- ✅ API key authentication for API endpoints
- ✅ Rate limiting (200 req/15min)
- ✅ Password protection
- ✅ Secure session cookies

## ⚡ Performance

- ✅ In-memory caching (5 min TTL)
- ✅ Fast video ID extraction
- ✅ Multiple download URL extraction methods
- ✅ Automatic retry on failures
- ✅ Optimized scraping

## 🐛 Troubleshooting

### "Invalid username or password"
Check your `.env` file and make sure `ADMIN_USERNAME` and `ADMIN_PASSWORD` are set correctly.

### "Invalid API key"
Make sure you're passing the correct API key:
- URL: `?key=YOUR_KEY`
- Header: `x-api-key: YOUR_KEY`

### No download URL available
Some videos may not have extractable download URLs. Try another video.

### Empty search results
The search query might not return results. Try different keywords.

## 📝 Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `ADMIN_USERNAME` | Web login username | `admin` |
| `ADMIN_PASSWORD` | Web login password | `SecurePass123!` |
| `API_KEY` | API authentication key | `my_api_key_12345` |
| `SESSION_SECRET` | Session encryption secret | `random32charstring...` |
| `PORT` | Server port (optional) | `3000` |

## 📄 License

MIT

## ⚠️ Disclaimer

This tool is for educational purposes only. Respect copyright laws and terms of service.

---

Made for XVideos downloading
