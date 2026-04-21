// Thin wrapper: delegates to featmap CLI with --dir pointing to local features
import * as path from "path";

const FEATURES_DIR = path.join(__dirname, "..", "features");

// Inject --dir if not already provided
const args = process.argv.slice(2);
if (!args.some((a) => a.startsWith("--dir"))) {
  args.push(`--dir=${FEATURES_DIR}`);
}

// Replace argv and run featmap CLI
process.argv = [process.argv[0], process.argv[1], ...args];
require("../../featmap/src/cli");
