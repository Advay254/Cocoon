import React, { useState, useEffect } from 'react';
import LoginPage from './LoginPage';
import SearchPage from './SearchPage';
import VideoPage from './VideoPage';
import AdminPage from './AdminPage';

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [page, setPage] = useState('search'); // 'search', 'video', 'admin'
  const [selectedVideoId, setSelectedVideoId] = useState(null);

  useEffect(() => {
    // Check session login on app load if implemented
  }, []);

  if (!loggedIn) {
    return <LoginPage onLoginSuccess={() => setLoggedIn(true)} />;
  }

  return (
    <div className="container mx-auto p-4">
      <nav className="mb-4 flex justify-between items-center">
        <button onClick={() => {setPage('search'); setSelectedVideoId(null)}} className="btn">Search</button>
        <button onClick={() => setPage('admin')} className="btn">Admin</button>
        <button onClick={() => {setLoggedIn(false); setPage('search'); setSelectedVideoId(null)}} className="btn btn-danger">Logout</button>
      </nav>
      {page === 'search' && <SearchPage onSelectVideo={id => {setSelectedVideoId(id); setPage('video');}} />}
      {page === 'video' && selectedVideoId && <VideoPage videoId={selectedVideoId} />}
      {page === 'admin' && <AdminPage />}
    </div>
  );
}

export default App;
