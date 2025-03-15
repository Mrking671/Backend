require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const port = process.env.PORT || 3000;

// Connect to MongoDB with additional logging
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1); // Exit if connection fails
  });

// Define movie schema and model
const movieSchema = new mongoose.Schema({
  file_id: String,
  file_name: String,
  file_size: Number,
  caption: String
});
const Movie = mongoose.model('vjcollection', movieSchema);

// Initialize Telegram Bot (polling disabled)
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// In-memory cache for TMDb details (if used)
const tmdbCache = {};

// Helper function to fetch TMDb details (optional; only if needed)
async function getTMDbDetails(title) {
  const tmdbKey = process.env.TMDB_API_KEY;
  if (!tmdbKey) {
    console.warn('TMDB_API_KEY not set.');
    return null;
  }
  if (tmdbCache[title]) return tmdbCache[title];

  // Clean up the title
  const cleanedTitle = title
    .replace(/\b(1080p|720p|480p|NF|WEB DL|DDP\d+\.\d+|AV1|Saon|mkv|mp4|S\d+E\d+|Episode \d+)\b/gi, "")
    .replace(/[\.\-_]/g, " ")
    .trim();

  console.log(`Searching TMDb for cleaned title: "${cleanedTitle}"`);

  try {
    const response = await axios.get('https://api.themoviedb.org/3/search/movie', {
      params: { api_key: tmdbKey, query: cleanedTitle }
    });
    console.log(`TMDb response for "${cleanedTitle}":`, response.data);

    if (response.data && response.data.results && response.data.results.length > 0) {
      const movieData = response.data.results[0];
      tmdbCache[title] = movieData;
      return movieData;
    }
    return null;
  } catch (err) {
    console.error("Error fetching TMDb data:", err);
    return null;
  }
}

// Endpoint: Get all movies with TMDb details
app.get('/movies', async (req, res) => {
  try {
    console.log("GET /movies endpoint hit");
    const movies = await Movie.find({});
    console.log(`Found ${movies.length} movies in DB`);
    const moviesWithDetails = await Promise.all(movies.map(async (movie) => {
      const tmdbData = await getTMDbDetails(movie.file_name);
      return { ...movie.toObject(), tmdb: tmdbData };
    }));
    res.json(moviesWithDetails);
  } catch (err) {
    console.error('Error in /movies:', err);
    res.status(500).json({ error: 'Failed to fetch movies' });
  }
});

// Endpoint: Search movies by title
app.get('/search', async (req, res) => {
  try {
    console.log("GET /search endpoint hit");
    const q = req.query.q || "";
    console.log("Search query:", q);
    const movies = await Movie.find({ file_name: { $regex: q, $options: 'i' } });
    console.log(`Found ${movies.length} movies for search query "${q}"`);
    const moviesWithDetails = await Promise.all(movies.map(async (movie) => {
      const tmdbData = await getTMDbDetails(movie.file_name);
      return { ...movie.toObject(), tmdb: tmdbData };
    }));
    res.json(moviesWithDetails);
  } catch (err) {
    console.error('Error in /search:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Endpoint: Get movie details by ID (with TMDb details)
app.get('/movie/:id', async (req, res) => {
  try {
    console.log(`GET /movie/${req.params.id} endpoint hit`);
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      console.warn(`Movie not found: ${req.params.id}`);
      return res.status(404).json({ error: 'Movie not found' });
    }
    const tmdbData = await getTMDbDetails(movie.file_name);
    res.json({ ...movie.toObject(), tmdb: tmdbData });
  } catch (err) {
    console.error('Error in /movie/:id:', err);
    res.status(500).json({ error: 'Failed to fetch movie details' });
  }
});

// Endpoint: Stream movie via Telegram
app.get('/stream/:id', async (req, res) => {
  try {
    console.log(`GET /stream/${req.params.id} endpoint hit`);
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      console.warn(`Movie not found for streaming: ${req.params.id}`);
      return res.status(404).json({ error: 'Movie not found' });
    }
    const file = await bot.getFile(movie.file_id);
    const filePath = file.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
    console.log("Streaming from URL:", downloadUrl);
    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'stream'
    });
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    res.setHeader('Content-Length', response.headers['content-length']);
    response.data.pipe(res);
  } catch (err) {
    console.error('Error in /stream/:id:', err);
    res.status(500).json({ error: 'Failed to stream movie' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
