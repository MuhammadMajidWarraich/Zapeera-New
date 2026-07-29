(async()=>{
  const token = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJjbW5mNWRmamswMDAxMWM4ODViNGpxOWR6IiwidXNlcm5hbWUiOiJzdXBlcmFkbWluX2RlbW8iLCJyb2xlIjoiU1VQRVJBRE1JTiIsImJyYW5jaElkIjpudWxsLCJjcmVhdGVkQnkiOm51bGwsInNlc3Npb25Ub2tlbiI6ImU2ODRhODBiY2RhMjI3YmU5YjcxNzE1NmMwNDhlNzk4NmJhMWFmMmU1YTU0NmQwYjNlMjg3ZDQxZDE1NTBmYTYiLCJpYXQiOjE3NzY2MTIwNjAsImV4cCI6MTc3NzIxNjg2MH0.EN1vBqXFF4VC7VvktnOmTcNwdG6BQDqPHlzq5qbnNYM';
  const base = 'http://localhost:4200/api/users?page=1&limit=200';
  const doFetch = async (hdrs) => {
    const res = await fetch(base, { method: 'GET', headers: hdrs });
    const txt = await res.text();
    try { return { status: res.status, body: JSON.parse(txt) }; } catch { return { status: res.status, body: txt }; }
  };

  console.log('--- SuperAdmin (no headers) ---');
  console.log(JSON.stringify(await doFetch({ Authorization: `Bearer ${token}` }), null, 2));

  console.log('\n--- SuperAdmin (with company/branch headers) ---');
  console.log(JSON.stringify(await doFetch({ Authorization: `Bearer ${token}`, 'x-company-id': 'cmnxuwtbl001k1c2ozx2dnxef', 'x-branch-id': 'cmo4qz7gx00011cl8ysjs4kly' }), null, 2));
})();
