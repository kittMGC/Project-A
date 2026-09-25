# HRM System

A Node.js + TypeScript web server (zero dependencies, built on Node's `http` module).

## Requirements

- Node.js >= 20

## Getting started

Install dependencies:

```bash
npm install
```

Start the web server in development (watches for changes):

```bash
npm run dev
# Server listening on http://localhost:3000
```

Then open <http://localhost:3000> in your browser, or:

```bash
curl http://localhost:3000/           # Hello, world!
curl "http://localhost:3000/?name=Ada" # Hello, Ada!
curl http://localhost:3000/health      # {"status":"ok"}
```

Set a custom port with the `PORT` environment variable:

```bash
PORT=8080 npm run dev
```

## Routes

| Method & path        | Response                              |
| -------------------- | ------------------------------------- |
| `GET /`              | Plain-text greeting (`?name=` query)  |
| `GET /health`        | JSON health check `{"status":"ok"}`   |

## Scripts

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Start the server in watch mode with `tsx`.   |
| `npm run build`     | Compile TypeScript to `dist/`.               |
| `npm start`         | Run the compiled app from `dist/`.           |
| `npm test`          | Run the test suite once with Vitest.         |
| `npm run test:watch`| Run tests in watch mode.                     |
| `npm run lint`      | Lint the codebase with ESLint.               |
| `npm run typecheck` | Type-check without emitting files.           |

## Project structure

```
.
├── src/
│   ├── index.ts        # Entry point — starts the HTTP server
│   ├── server.ts       # Request handler and server factory
│   ├── server.test.ts  # Tests for the server routes
│   ├── greet.ts        # Greeting module
│   └── greet.test.ts   # Tests for greet
├── package.json
├── tsconfig.json
├── eslint.config.js
└── .gitignore
```

## License

MIT
