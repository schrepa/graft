# @schrepa/create-graft-app

Scaffold a new Graft project.

## Usage

```bash
npx @schrepa/create-graft-app my-app
cd my-app
npm install
npm run dev
```

Then open the studio to browse and test your tools:

```bash
npm run studio
```

## What It Generates

The generated project includes a small greenfield Graft app:

- `src/app.ts` — app bootstrap that registers the example tools
- `src/tools/echo.ts` — read-only example tool with examples
- `src/tools/store-value.ts` — side-effecting example tool with examples
- `README.md`, `package.json`, and `tsconfig.json` wired for the `graft` CLI from `@schrepa/graft`

## License

Apache-2.0
