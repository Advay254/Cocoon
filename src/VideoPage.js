import React, { useState, useEffect } from 'react';

function VideoPage({ videoId }) {
  const [video, setVideo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchVideo = async () => {
      setError(null);
      const auth = localStorage.getItem('auth');
      try {
        const res = await fetch(`/video?id=${videoId}`, {
          headers: { 'Authorization': `Basic ${auth}` }
        });
        if (!res.ok) {
          setError('Video not found');
          return;
        }
        const data = await res.json();
        setVideo(data);
      } catch {
        setError('Network Error');
      }
    };
    fetchVideo();
  }, [videoId]);

  if (error) return <p className="text-red-500">{error}</p>;
  if (!video) return <p>Loading...</p>;

  return (
    <div className="p-4 border rounded">
      <h2 className="text-xl font-bold mb-2">{video.title}</h2>
      <iframe title="video embed" src={video.embed_url} allowFullScreen className="w-full h-64 mb-2"></iframe>
      <p><strong>Duration:</strong> {video.duration}</p>
      <p><strong>Categories:</strong> {video.categories.join(', ')}</p>
      <p><strong>Performers:</strong> {video.performers.join(', ')}</p>
      <p><strong>Tags:</strong> {video.tags.join(', ')}</p>
      <a className="btn btn-secondary mt-2 inline-block" href={video.download_link} target="_blank" rel="noopener noreferrer">Download Video</a>
    </div>
  );
}

export default VideoPage;
