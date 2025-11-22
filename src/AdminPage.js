import React, { useState, useEffect } from 'react';

function AdminPage() {
  const [apiKeys, setApiKeys] = useState([]);
  const [error, setError] = useState(null);

  const fetchKeys = async () => {
    setError(null);
    const auth = localStorage.getItem('auth');
    try {
      const res = await fetch('/admin', { headers: { 'Authorization': `Basic ${auth}` } });
      if (!res.ok) {
        setError('Access denied or error fetching keys');
        return;
      }
      const data = await res.json();
      setApiKeys(data.api_keys);
    } catch {
      setError('Network error');
    }
  };

  const revokeKey = async (key) => {
    const auth = localStorage.getItem('auth');
    try {
      const res = await fetch('/admin/revoke?key=' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}` }
      });
      if (!res.ok) {
        setError('Failed to revoke key');
        return;
      }
      fetchKeys();
    } catch {
      setError('Network error');
    }
  };

  React.useEffect(() => {
    fetchKeys();
  }, []);

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Admin Dashboard</h2>
      {error && <p className="text-red-500">{error}</p>}
      {apiKeys.length === 0 ? (
        <p>No active API keys.</p>
      ) : (
        <ul className="list-disc pl-5">
          {apiKeys.map(key => (
            <li key={key} className="mb-1">
              {key} <button className="btn btn-danger btn-sm ml-2" onClick={() => revokeKey(key)}>Revoke</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AdminPage;
