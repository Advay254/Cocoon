<div align="center">

# 🦋 Cocoon - Production Ready

*A complete adult video downloader with a clean web interface and REST API for smooth automation*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-16+-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

</div>

---

## ✨ What's Inside

### 🌐 Beautiful Web Interface
- Simple login system to keep things secure
- Search for videos using any keywords
- Browse results in a nice grid layout
- Click any video to watch and download
- Get direct MP4 download links instantly

### 🔌 Easy-to-Use REST API
- `/api/search` - Find videos by keyword
- `/api/video/:id` - Get video details and download link
- `/api/download/:id` - Download videos directly
- `/api/health` - Check if everything's running smoothly

---

## 📁 Project Structure

Here's what you'll find inside:

```
cocoon-downloader/
├── server.js              # Main app logic
├── package.json           # Project info and dependencies
├── .env                   # Your secret settings (you'll create this)
├── .env.example           # Example settings file
├── .gitignore             # Files Git should ignore
├── README.md              # You're reading it!
├── views/
│   ├── login.ejs          # Login page
│   ├── home.ejs           # Search page
│   ├── results.ejs        # Results grid
│   └── video.ejs          # Video player and download
└── public/                # Folder for images, CSS, etc. (create empty)
```

---

## 🚀 Getting Started

### Step 1: Create Your Project Folder

```bash
mkdir cocoon-downloader
cd cocoon-downloader
```

### Step 2: Add All the Files

Create these files using the content from the artifacts:
- `server.js`
- `package.json`
- `.env.example`
- `.gitignore`
- `README.md`

### Step 3: Create the Views Folder

```bash
mkdir views
```

Then add these files inside `views/`:
- `login.ejs`
- `home.ejs`
- `results.ejs`
- `video.ejs`

### Step 4: Create the Public Folder

```bash
mkdir public
```

*(Leave this empty for now - you can add custom styles or images later)*

### Step 5: Set Up Your Settings

```bash
cp .env.example .env
```

Open the `.env` file and customize it:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=YourSecurePassword123!
API_KEY=your_secret_api_key_here
SESSION_SECRET=a_random_string_at_least_32_characters_long
PORT=3000
```

### Step 6: Install Everything You Need

```bash
npm install
```

### Step 7: Run It Locally

```bash
npm start
```

Open your browser and go to: `http://localhost:3000`

---

## 🌐 Deploy to the Cloud (Render)

### Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit - Cocoon Video Downloader"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

### Deploy on Render.com

1. Head to https://render.com and sign in
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repo
4. Fill in the details:
   - **Name**: `cocoon-downloader`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Add your settings (Environment Variables):
   - `ADMIN_USERNAME` = your chosen username
   - `ADMIN_PASSWORD` = your chosen password
   - `API_KEY` = your chosen API key
   - `SESSION_SECRET` = a random 32+ character string
6. Click **"Create Web Service"**

Done! Your app will be live in a few minutes.

---

## 📖 How to Use It

### Using the Web Interface

1. **Log In**: 
   - Go to your app's URL (like `https://your-app.onrender.com`)
   - Enter your username and password

2. **Search for Videos**:
   - Type keywords into the search box
   - Hit the "Search" button
   - See all results in a grid

3. **Download Videos**:
   - Click on any video thumbnail
   - Watch the preview
   - Click "Download Now" to save the MP4 file

### Using the API

All API calls need an API key. Add it to your URL like `?key=YOUR_KEY` or use the header `x-api-key: YOUR_KEY`

#### 1. Check Server Health

```bash
GET /api/health
```

Response:
```json
{
  "status": "ok",
  "uptime": 12345,
  "cache": 5,
  "timestamp": "2025-11-23T..."
}
```

#### 2. Search for Videos

```bash
GET /api/search?key=YOUR_KEY&q=funny
```

Response:
```json
{
  "success": true,
  "query": "funny",
  "page": 0,
  "count": 27,
  "videos": [
    {
      "id": "12345678",
      "title": "Funny Video",
      "duration": "10:30",
      "thumbnail": "https://...",
      "url": "https://www.example-video-site.com/video12345678/..."
    }
  ]
}
```

#### 3. Get Video Info

```bash
GET /api/video/12345678?key=YOUR_KEY
```

Response:
```json
{
  "success": true,
  "video": {
    "id": "12345678",
    "title": "Funny Video",
    "duration": "10:30",
    "thumbnail": "https://...",
    "downloadUrl": "https://...video.mp4",
    "embedUrl": "https://www.example-video-site.com/embedframe/12345678",
    "pageUrl": "https://www.example-video-site.com/video12345678/"
  }
}
```

#### 4. Download Directly

```bash
GET /api/download/12345678?key=YOUR_KEY
```

This takes you straight to the MP4 download.

---

## 💻 Code Examples

### JavaScript/Node.js

```javascript
const axios = require('axios');

const API_URL = 'https://your-app.onrender.com';
const API_KEY = 'your_api_key';

// Search for videos
async function searchVideos(query) {
  const { data } = await axios.get(`${API_URL}/api/search`, {
    params: { key: API_KEY, q: query }
  });
  return data.videos;
}

// Get download link
async function getDownloadUrl(videoId) {
  const { data } = await axios.get(`${API_URL}/api/video/${videoId}`, {
    params: { key: API_KEY }
  });
  return data.video.downloadUrl;
}

// Download video to your computer
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

// Try it out
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

# Search for videos
def search_videos(query):
    response = requests.get(
        f'{API_URL}/api/search',
        params={'key': API_KEY, 'q': query}
    )
    return response.json()['videos']

# Get download link
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

# Try it out
videos = search_videos('funny')
print(f'Found {len(videos)} videos')

video_id = videos[0]['id']
download_video(video_id, 'video.mp4')
print('Downloaded!')
```

### cURL (Command Line)

```bash
# Search
curl "https://your-app.onrender.com/api/search?key=YOUR_KEY&q=funny"

# Get video info
curl "https://your-app.onrender.com/api/video/12345678?key=YOUR_KEY"

# Download video
curl -L -o video.mp4 "https://your-app.onrender.com/api/download/12345678?key=YOUR_KEY"
```

---

## 🔒 Built-In Security

- ✅ Login system for web access
- ✅ API key protection for automation
- ✅ Smart rate limiting (200 requests per 15 minutes)
- ✅ Password-protected admin panel
- ✅ Safe session handling

---

## ⚡ Performance Features

- ✅ Built-in caching (keeps things fast for 5 minutes)
- ✅ Quick video ID detection
- ✅ Multiple backup methods for finding download links
- ✅ Smart retry system if something fails
- ✅ Optimized web scraping

---

## 🐛 Common Issues & Fixes

### "Invalid username or password"
Double-check your `.env` file. Make sure `ADMIN_USERNAME` and `ADMIN_PASSWORD` match what you're typing.

### "Invalid API key"
Make sure you're sending the API key correctly:
- In the URL: `?key=YOUR_KEY`
- In headers: `x-api-key: YOUR_KEY`

### Can't find a download link
Some videos might not work. Try a different video or search term.

### No search results
Your search might be too specific. Try simpler or different keywords.

---

## 📝 Settings Reference

| Setting | What It Does | Example |
|---------|--------------|---------|
| `ADMIN_USERNAME` | Your login username | `admin` |
| `ADMIN_PASSWORD` | Your login password | `SecurePass123!` |
| `API_KEY` | Key for API access | `my_api_key_12345` |
| `SESSION_SECRET` | Keeps sessions secure | `random32charstring...` |
| `PORT` | Port to run on (optional) | `3000` |

---

## 🤝 Want to Help?

This project is open source and we'd love your help making it better! Here's how:

1. **Fork** this repo to your own account
2. **Create** a new branch for your changes
3. **Make** your improvements or fixes
4. **Test** everything works smoothly
5. **Submit** a pull request with details about what you changed

Before submitting:
- Make sure your code is clean and easy to read
- Test that everything still works
- Add comments to explain tricky parts

### ⭐ Show Your Support

If you find this useful, consider:
- Giving this repo a star ⭐
- Sharing it with others who might need it
- Reporting any bugs you find

---

## 📋 Usage Terms

### For Personal Use
Feel free to use this however you like for your own projects!

### For Production/Commercial Use
If you're planning to use this in a production environment or for commercial purposes:

1. **Give Credit**: Please mention this project and link back to the original repo
2. **Ask Permission**: Open an issue or reach out if you're using this in a big project
3. **Share Back**: If you make cool improvements, consider contributing them back!

We're friendly and reasonable - just want to know how Cocoon is being used out in the world. 😊

---

## 📄 License

MIT License - see the LICENSE file for details

---

## ⚠️ Important Notice

This tool is built for learning and personal use. Please:
- Respect copyright laws in your country
- Follow the terms of service of websites you interact with
- Use responsibly and ethically

---

<div align="center">

**Built with ❤️ for easy video downloading**

*Questions? Ideas? Open an issue and let's chat!*

</div>
