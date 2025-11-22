import React, { useState } from 'react';

function LoginPage({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const handleSubmit = async e => {
    e.preventDefault();
    const auth = btoa(`${username}:${password}`);
    // Test login by calling search endpoint with auth
    const res = await fetch('/search?q=test', {
      headers: { 'Authorization': `Basic ${auth}` },
    });
    if (res.ok) {
      localStorage.setItem('auth', auth);
      onLoginSuccess();
    } else {
      setError('Login failed, check credentials');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-sm mx-auto mt-20 p-6 border rounded shadow">
      <h2 className="text-xl mb-4">Login</h2>
      {error && <p className="text-red-500">{error}</p>}
      <label>Username
        <input value={username} onChange={e => setUsername(e.target.value)} required className="input" />
      </label>
      <label>Password
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="input" />
      </label>
      <button type="submit" className="btn btn-primary mt-4">Login</button>
    </form>
  )
}

export default LoginPage;
