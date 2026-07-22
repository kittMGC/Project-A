# Project A

A Node.js + TypeScript project.

## Requirements

- Node.js >= 20

## Getting started

Install dependencies:

```bash
npm install
```

Run in development (watches for changes):

```bash
npm run dev
```

Pass a name as an argument:

```bash
npm run dev -- Ada
# Hello, Ada!
```

## Scripts

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Run the app in watch mode with `tsx`.        |
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
│   ├── index.ts        # Entry point
│   ├── greet.ts        # Example module
│   └── greet.test.ts   # Tests for greet
├── package.json
├── tsconfig.json
├── eslint.config.js
└── .gitignore
```

## License

MIT
