# Connect Game

A multiplayer word-guessing game where players work together to guess a secret word chosen by the host. The word is revealed one character at a time through clever hints and guesses.

## Features

- Real-time multiplayer gameplay using Socket.IO
- Host and player roles with different capabilities
- Priority window for host guesses
- Detailed game history
- Prevention of duplicate hint words
- Beautiful, responsive UI

## Local Development

1. Clone the repository:
```bash
git clone <your-repo-url>
cd connect-game
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open http://localhost:5001 in your browser

## Deployment

This application is ready to be deployed on Render.com. Follow these steps:

1. Create a Render account at https://render.com
2. Click "New +" and select "Web Service"
3. Connect your GitHub repository
4. Use the following settings:
   - Name: connect-game (or your preferred name)
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: Free

## Environment Variables

The following environment variables can be configured:

- `PORT`: The port number (default: 5001)

## License

MIT 