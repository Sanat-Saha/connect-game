const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Serve the HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'templates', 'index.html'));
});

// Serve the How to Play page
app.get('/how-to-play', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'templates', 'how-to-play.html'));
});

// Game state
const games = new Map();

// Helper function to get formatted player list
function getPlayersList(game) {
  return Array.from(game.players.entries()).map(([id, player]) => ({
    id,
    username: player.username,
    isHost: player.isHost
  }));
}

// Helper function to broadcast game state to all players
function broadcastGameState(gameId) {
  try {
    const game = games.get(gameId);
    if (!game) return;

    const gameState = {
      game_id: gameId,
      host: game.host,
      revealed_chars: game.revealed_chars,
      players: getPlayersList(game),
      current_hint: game.current_hint,
      hint_giver: game.hint_giver,
      hint_timestamp: game.hint_timestamp,
      history: game.history || []
    };

    io.to(gameId).emit('game_state', gameState);
  } catch (error) {
    console.error('Error in broadcastGameState:', error);
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('create_game', (data) => {
    try {
      if (!data?.word || !data?.username) {
        socket.emit('error', { message: 'Invalid game creation data' });
        return;
      }

      const gameId = Math.random().toString(36).substring(7);
      games.set(gameId, {
        host: socket.id,
        word: data.word.toLowerCase(),
        revealed_chars: data.word[0],
        players: new Map([[socket.id, { username: data.username, isHost: true }]]),
        current_hint: null,
        hint_giver: null,
        hint_timestamp: null,
        status: 'active',
        history: [],
        used_hints: new Set()
      });
      
      socket.join(gameId);
      broadcastGameState(gameId);
    } catch (error) {
      console.error('Error in create_game:', error);
      socket.emit('error', { message: 'Failed to create game' });
    }
  });

  socket.on('join_game', (data) => {
    try {
      if (!data?.game_id || !data?.username) {
        socket.emit('error', { message: 'Invalid join game data' });
        return;
      }

      const game = games.get(data.game_id);
      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      // Add new player to the game
      game.players.set(socket.id, { username: data.username, isHost: false });
      socket.join(data.game_id);
      
      // Add join message to history
      game.history.push({
        type: 'player_joined',
        username: data.username,
        timestamp: Date.now()
      });
      
      broadcastGameState(data.game_id);
    } catch (error) {
      console.error('Error in join_game:', error);
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  socket.on('submit_hint', (data) => {
    try {
      console.log('\n=== SUBMIT HINT EVENT ===');
      if (!data?.game_id || !data?.hint || !data?.target_word) {
        socket.emit('error', { message: 'Invalid hint data' });
        return;
      }

      const game = games.get(data.game_id);
      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      if (socket.id === game.host) {
        socket.emit('error', { message: 'Host cannot submit hints' });
        return;
      }

      const targetWord = (data.target_word || '').toLowerCase().trim();
      const hostWord = (game.word || '').toLowerCase().trim();
      
      // Validate target word starts with revealed characters
      if (!targetWord.startsWith(game.revealed_chars.toLowerCase())) {
        socket.emit('error', { message: 'Target word must start with the revealed characters' });
        return;
      }

      // Check if hint word has been used before
      if (game.used_hints.has(targetWord.toLowerCase())) {
        socket.emit('error', { message: 'This word has already been used as a hint!' });
        return;
      }

      // Check if the target word matches the host's word
      if (targetWord === hostWord) {
        const hintGiverName = game.players.get(socket.id)?.username;
        if (!hintGiverName) return;
        
        // Add to history
        game.history.push({
          type: 'game_over',
          winner: 'hint_match',
          hint_giver: hintGiverName,
          word: game.word,
          timestamp: Date.now()
        });

        // End game - hint giver found the exact word
        io.to(data.game_id).emit('game_over', {
          winner: 'hint_match',
          hint_giver: hintGiverName,
          word: game.word
        });
        
        games.delete(data.game_id);
        return;
      }

      // If target word doesn't match, proceed with normal hint flow
      game.current_hint = {
        hint: data.hint,
        target_word: data.target_word
      };
      game.hint_giver = socket.id;
      game.hint_timestamp = Date.now() / 1000;
      
      // Add the hint word to used hints
      game.used_hints.add(targetWord.toLowerCase());
      
      // Add hint to history
      game.history.push({
        type: 'hint',
        username: game.players.get(socket.id)?.username || 'Unknown Player',
        hint: data.hint,
        timestamp: Date.now()
      });
      
      broadcastGameState(data.game_id);
    } catch (error) {
      console.error('Error in submit_hint:', error);
      socket.emit('error', { message: 'Failed to submit hint' });
    }
  });

  socket.on('submit_guess', (data) => {
    try {
      if (!data?.game_id || !data?.guess) {
        socket.emit('error', { message: 'Invalid guess data' });
        return;
      }

      const game = games.get(data.game_id);
      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      if (socket.id === game.hint_giver) {
        socket.emit('error', { message: 'Hint giver cannot guess' });
        return;
      }

      const guess = data.guess.toLowerCase().trim();
      const hostWord = game.word.toLowerCase();
      const targetWord = game.current_hint?.target_word?.toLowerCase();
      const isHost = socket.id === game.host;
      const guesserName = game.players.get(socket.id)?.username;
      
      if (!guesserName) {
        socket.emit('error', { message: 'Player not found' });
        return;
      }

      if (guess === hostWord) {
        // Add to history
        game.history.push({
          type: 'game_over',
          winner: 'players',
          guesser: guesserName,
          word: game.word,
          timestamp: Date.now()
        });

        // End game - word was guessed correctly
        io.to(data.game_id).emit('game_over', {
          winner: 'players',
          word: game.word
        });
        games.delete(data.game_id);
      } else if (targetWord && guess === targetWord) {
        let newRevealedChars = game.revealed_chars;
        
        // Only reveal next character if the correct guesser is NOT the host
        if (!isHost) {
          const currentRevealedLength = game.revealed_chars.length;
          if (currentRevealedLength < game.word.length) {
            newRevealedChars = game.word.substring(0, currentRevealedLength + 1);
            game.revealed_chars = newRevealedChars;

            // Check if all characters are now revealed
            if (newRevealedChars.length === game.word.length) {
              // Add game completion to history
              game.history.push({
                type: 'game_over',
                winner: 'completion',
                word: game.word,
                timestamp: Date.now()
              });

              // End game - all characters revealed
              io.to(data.game_id).emit('game_over', {
                winner: 'completion',
                word: game.word
              });
              games.delete(data.game_id);
              return;
            }
          }
        } else {
          // If host correctly guessed the hint word, clear the timer for everyone
          io.to(data.game_id).emit('timer_clear');
        }

        // Add correct guess to history
        game.history.push({
          type: 'correct_guess',
          username: guesserName,
          guess: guess,
          revealed_chars: newRevealedChars,
          timestamp: Date.now()
        });

        // Reset hint state and timer
        game.current_hint = null;
        game.hint_giver = null;
        game.hint_timestamp = null;
        
        broadcastGameState(data.game_id);
      } else {
        // Add incorrect guess to history
        game.history.push({
          type: 'incorrect_guess',
          username: guesserName,
          guess: guess,
          timestamp: Date.now()
        });
        
        socket.emit('incorrect_guess');
        broadcastGameState(data.game_id);
      }
    } catch (error) {
      console.error('Error in submit_guess:', error);
      socket.emit('error', { message: 'Failed to submit guess' });
    }
  });

  socket.on('disconnect', () => {
    try {
      console.log('Client disconnected');
      // Find and clean up any games this player was in
      for (const [gameId, game] of games.entries()) {
        if (game.players.has(socket.id)) {
          const disconnectedPlayer = game.players.get(socket.id);
          if (!disconnectedPlayer) continue;

          game.players.delete(socket.id);
          
          // Add disconnect to history
          game.history.push({
            type: 'player_left',
            username: disconnectedPlayer.username,
            timestamp: Date.now()
          });

          // If host left, assign new host or end game
          if (socket.id === game.host && game.players.size > 0) {
            const newHost = game.players.keys().next().value;
            game.host = newHost;
            const player = game.players.get(newHost);
            if (player) {
              player.isHost = true;
              broadcastGameState(gameId);
            }
          } else if (game.players.size === 0) {
            games.delete(gameId);
          } else {
            broadcastGameState(gameId);
          }
        }
      }
    } catch (error) {
      console.error('Error in disconnect:', error);
    }
  });
});

const PORT = process.env.PORT || 5001;

// Store server instance for graceful shutdown
let serverInstance = null;

// Function to gracefully shutdown the server
function shutdownServer() {
  if (serverInstance) {
    console.log('Shutting down existing server...');
    serverInstance.close(() => {
      console.log('Server shut down successfully');
      startServer();
    });
  } else {
    startServer();
  }
}

// Function to start the server
function startServer() {
  serverInstance = server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Handle server errors
  serverInstance.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} is busy, attempting to close existing connection...`);
      require('child_process').exec(`lsof -i :${PORT} | grep LISTEN | awk '{print $2}' | xargs kill -9`, (err) => {
        if (err) {
          console.error('Failed to kill process:', err);
          process.exit(1);
        }
        console.log('Killed existing process, restarting server...');
        setTimeout(startServer, 1000);
      });
    } else {
      console.error('Server error:', error);
      process.exit(1);
    }
  });
}

// Handle process termination
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  if (serverInstance) {
    serverInstance.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  if (serverInstance) {
    serverInstance.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

// Start the server
shutdownServer(); 