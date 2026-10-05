import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Disable etag / set no-cache for index.html and sw.js
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html' || req.path === '/sw.js') {
    res.setHeader('Cache-Control', 'no-cache');
  }
  next();
});

// Serve static assets from applet root
app.use(express.static(__dirname, {
  extensions: ['html'],
  index: 'index.html'
}));

// SPA fallback to index.html
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: __dirname });
});

app.listen(PORT, HOST, () => {
  console.log(`LiftTracker server listening on http://${HOST}:${PORT}`);
});
