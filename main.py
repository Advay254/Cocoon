import os
import secrets
import httpx
from fastapi import FastAPI, Depends, HTTPException, status, Query, Request
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware
from typing import List
from bs4 import BeautifulSoup

app = FastAPI(title="XVideo Automation API with Scraping")

# CORS origins: adjust domain for your deployed frontend
origins = ["http://localhost:3000", "https://your-render-domain.onrender.com"]
app.add_middleware(
    CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)
app.add_middleware(SessionMiddleware, secret_key=os.getenv("SESSION_SECRET", "supersecretkey"))

security = HTTPBasic()

# Environment variables for credentials and API key
APP_USERNAME = os.getenv("APP_USERNAME", "admin")
APP_PASSWORD = os.getenv("APP_PASSWORD", "changeme")
APP_API_KEY = os.getenv("APP_API_KEY", "defaultkey")

# Simple in-memory rate limiting store: IP -> timestamps list
rate_limit = {}
RATE_LIMIT_PER_MINUTE = 10

def check_rate_limit(client_ip: str):
    import time
    current_time = time.time()
    window_start = current_time - 60
    times = rate_limit.get(client_ip, [])
    # keep timestamps in the last minute
    times = [t for t in times if t > window_start]

    if len(times) >= RATE_LIMIT_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    times.append(current_time)
    rate_limit[client_ip] = times

def verify_auth(credentials: HTTPBasicCredentials = Depends(security)):
    correct_username = secrets.compare_digest(credentials.username, APP_USERNAME)
    correct_password = secrets.compare_digest(credentials.password, APP_PASSWORD)
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username

@app.get("/search")
async def search_videos(q: str = Query(..., min_length=1), request: Request = Depends(), user: str = Depends(verify_auth)):
    client_ip = request.client.host if request else "unknown"
    check_rate_limit(client_ip)

    search_url = f"https://www.xvideos.com/?k={q}"
    async with httpx.AsyncClient() as client:
        resp = await client.get(search_url)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

    videos = []

    # Parse search results page
    for div in soup.select("div.thumb-block"):
        try:
            title_tag = div.select_one("a.img") or div.select_one("a")
            title = title_tag['title'].strip()
            href = title_tag["href"].strip()
            # Correct video id extraction from URL of the format "/video123456/title"
            import re
            id_match = re.search(r'/video(\d+)', href)
            video_id = id_match.group(1) if id_match else ""
            img_tag = div.select_one("img")
            thumb = ""
            if img_tag:
                thumb = img_tag.get("data-src") or img_tag.get("src") or ""
            duration = ""
            duration_span = div.select_one("span.duration")
            if duration_span:
                duration = duration_span.text.strip()
            embed_url = f"https://www.xvideos.com/embedframe/{video_id}" if video_id else ""

            if video_id:  # Only append if we have a valid ID
                videos.append({
                    "id": video_id,
                    "title": title,
                    "thumbnail": thumb,
                    "embed_url": embed_url,
                    "duration": duration,
                    "preview_clip": thumb  # XVideos does not provide preview clip easily, using thumbnail here
                })
        except Exception:
            continue

    return {"query": q, "results": videos}

@app.get("/video")
async def video_details(id: str, request: Request = Depends(), user: str = Depends(verify_auth)):
    client_ip = request.client.host if request else "unknown"
    check_rate_limit(client_ip)
    
    video_url = f"https://www.xvideos.com/video{id}"
    async with httpx.AsyncClient() as client:
        resp = await client.get(video_url)
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Video not found")
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

    # Title
    title_tag = soup.select_one("h2.title")
    title = title_tag.text.strip() if title_tag else "No title"

    # Thumbnail and preview (screenshot)
    thumbnail = soup.select_one('meta[property="og:image"]')
    thumbnail_url = thumbnail["content"] if thumbnail else ""

    # Duration
    duration_span = soup.select_one("span.duration")
    duration = duration_span.text.strip() if duration_span else ""

    # Categories and tags
    categories = [cat.text.strip() for cat in soup.select("div#categories li a")]
    tags = [tag.text.strip() for tag in soup.select("div#tags li a")]

    # Performers (actors)
    performers = [perf.text.strip() for perf in soup.select("div#pornstars li a")]

    # Video download URL: XVideos does not provide direct download links publicly, must scrape player source
    download_link = ""
    try:
        # locate player sources in script tags
        import re
        import json
        for script in soup.find_all("script"):
            if "sources" in script.text:
                # Improved regex & JSON parsing
                pattern = re.compile(r'sources\s*:\s*(\[[^\]]+\])')
                match = pattern.search(script.text)
                if match:
                    # Replace single quotes with double for JSON, be wary of edge-cases
                    sources_str = match.group(1).replace("'", '"')
                    sources = json.loads(sources_str)
                    # Pick best quality mp4 url
                    for source in sources:
                        if source.get("type") == "video/mp4":
                            download_link = source.get("src")
                            break
                if download_link:
                    break
    except Exception:
        pass

    return {
        "id": id,
        "title": title,
        "thumbnail": thumbnail_url,
        "duration": duration,
        "categories": categories,
        "tags": tags,
        "performers": performers,
        "embed_url": f"https://www.xvideos.com/embedframe/{id}",
        "preview_clip": thumbnail_url,
        "download_link": download_link,
        "sprite_previews": []  # can be expanded if XVideos sprites are scraped
    }

@app.get("/admin")
async def admin_dashboard(user: str = Depends(verify_auth)):
    return {"api_keys": [APP_API_KEY]}

@app.post("/admin/revoke")
async def revoke_key(key: str, user: str = Depends(verify_auth)):
    # For simplicity, revoking is not supported (only 1 key)
    raise HTTPException(status_code=501, detail="API key revocation not implemented")

@app.get("/docs")
async def docs():
    return JSONResponse(content={
        "info": "XVideos Automation API with scraping",
        "endpoints": {
            "/search?q=keyword": "Search videos by keyword (auth required).",
            "/video?id=videoID": "Get detailed video info including download link (auth required).",
            "/admin": "Admin dashboard to view API key (auth required)."
        }
    })
