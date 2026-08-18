/**
 * The entry point, and nothing else.
 *
 * This exists because the previous arrangement guarded `main()` behind a test
 * on `process.argv[1]` so the suite could import the helpers beside it. The
 * bundle is emitted as `docket-check.cjs`, the guard was looking for
 * `cli/check`, and so the built gate ran nothing, printed nothing, and exited
 * 0 -- on a repository with a failing test and an agent lying about it.
 *
 * A gate that passes everything in silence is the worst failure this product
 * can have, and it survived a clean typecheck, a clean lint and a successful
 * build. Only running the built artifact found it. Hence a file whose whole
 * job is to be run, and a library beside it that is only ever imported.
 */
import { main, EXIT } from "./check";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`docket check failed: ${(error as Error).stack ?? String(error)}\n`);
    process.exit(EXIT.unusable);
  },
);
