const assert = require("node:assert/strict");
const Parser = require("web-tree-sitter");

async function parse(languageFile, source, expectedRoot) {
  const language = await Parser.Language.load(require.resolve(languageFile));
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  assert.equal(tree.rootNode.type, expectedRoot);
  assert.equal(tree.rootNode.hasError(), false);
  tree.delete();
  parser.delete();
}

(async () => {
  await Parser.init({
    locateFile() {
      return require.resolve("web-tree-sitter/tree-sitter.wasm");
    }
  });
  await parse(
    "tree-sitter-wasms/out/tree-sitter-c_sharp.wasm",
    "public sealed class World { public Entity Spawn() => new(); }",
    "compilation_unit"
  );
  await parse(
    "tree-sitter-wasms/out/tree-sitter-cpp.wasm",
    "class World { public: Entity Spawn(); };",
    "translation_unit"
  );
  process.stdout.write("Tree-sitter C# and C++ checks passed\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
