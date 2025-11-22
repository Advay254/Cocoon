import React, { useState } from 'react';

function SearchPage({ onSelectVideo }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  const doSearch = async (e) => {
    e.preventDefault();
    setError(null);
    const auth = localStorage.getItem('auth');
    try {
      const res = await fetch(`/search?q=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Basic ${auth}` }
      });
      if (!res.ok) {
        setError('Error performing search');
        return;
      }
      const data = await res.json();
      setResults(data.results);
    } catch {
      setError('Network error');
    }
  };

  return (
    <div>
      <form onSubmit={doSearch} className="mb-4 flex">
        <input className="input flex-grow" placeholder="Search videos..." value={query} onChange={e => setQuery(e.target.value)} required />
        <button type="submit" className="btn btn-primary ml-2">Search</button>
      </form>
      {error && <p className="text-red-500">{error}</p>}
      {results.length === 0 && <p>No results.</p>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {results.map(v => (
          <div key={v.id} className="border rounded p-2 cursor-pointer" onClick={() => onSelectVideo(v.id)}>
            <img src={v.thumbnail} alt={v.title} className="mb-2 w-full object-cover" />
            <h3 className="font-semibold">{v.title}</h3>
            <p>Duration: {v.duration}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SearchPage;
