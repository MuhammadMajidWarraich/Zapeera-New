function registerSseRoutes(app, authMiddleware, deps) {
  app.get('/api/sse/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connection established' })}\n\n`);

    const keepAlive = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
    });
  });
}

module.exports = {
  registerSseRoutes
};
