# Contributing

Thanks for helping improve Family Message Box. Bug reports, documentation,
translations, accessibility work, CAD variants, tests, and code are welcome.

## Before you start

- Search existing issues and pull requests.
- Open an issue before a large behavior, protocol, database, or enclosure change
  so maintainers and builders can agree on the direction.
- Never include credentials, phone numbers, Wi-Fi details, message history,
  audio, private keys, live databases, faces, or other personal data.
- Keep a pull request focused. Explain user impact, safety implications, and the
  evidence used to verify it.

## Development workflow

1. Fork the repository and branch from current `main`.
2. Install dependencies with `npm ci`.
3. Add or update tests before implementation where practical.
4. Run `npm run verify` and `npm audit --audit-level=high`.
5. Use a Conventional Commit subject such as
   `fix: retain messages after failed playback`.
6. Open a pull request and complete the template.

Firmware changes must also pass:

```bash
pio run -d firmware -e esp32-s3-wroom-1-n16r8
```

Enclosure changes must keep the editable source and derived exports together:

```bash
./firmware/enclosure/export.sh
node firmware/enclosure/validate_exports.mjs
```

Do not commit machine/material-specific G-code. Include slicer settings and
screenshots or attach G-code to a release when it is genuinely useful.

## Pull request evidence

State which levels were actually proven:

- automated tests and static checks;
- application or firmware build;
- Docker container health;
- bench hardware test;
- physical device behavior.

A passing local test is not evidence that a physical box was flashed or worked.
Hardware-facing changes should describe the board, wiring, power source,
printer/material, and safety checks used without disclosing private network or
personal information.

By contributing, you agree that your contribution is licensed under the
project's [MIT License](LICENSE).
