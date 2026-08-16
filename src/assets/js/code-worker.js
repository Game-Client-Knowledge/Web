"use strict";

let ParserClass = null;
let parser = null;
const languages = new Map();

const DECLARATION_KINDS = {
  class_declaration: "class",
  struct_declaration: "struct",
  interface_declaration: "interface",
  enum_declaration: "enum",
  record_declaration: "record",
  method_declaration: "method",
  constructor_declaration: "constructor",
  property_declaration: "property",
  event_declaration: "event",
  enum_member_declaration: "enum-member",
  namespace_declaration: "namespace",
  class_specifier: "class",
  struct_specifier: "struct",
  enum_specifier: "enum",
  function_definition: "function"
};

const CONTAINER_TYPES = new Set([
  "namespace_declaration",
  "class_declaration",
  "struct_declaration",
  "interface_declaration",
  "record_declaration",
  "enum_declaration",
  "class_specifier",
  "struct_specifier",
  "enum_specifier"
]);

const IDENTIFIER_TYPES = new Set([
  "identifier",
  "type_identifier",
  "field_identifier",
  "namespace_identifier"
]);

function firstIdentifier(node) {
  if (!node) {
    return null;
  }
  if (IDENTIFIER_TYPES.has(node.type)) {
    return node;
  }
  const stack = [...node.namedChildren].reverse();
  while (stack.length) {
    const current = stack.pop();
    if (IDENTIFIER_TYPES.has(current.type)) {
      return current;
    }
    stack.push(...current.namedChildren.slice().reverse());
  }
  return null;
}

function declarationNames(node) {
  if (node.type === "field_declaration") {
    return node
      .descendantsOfType("variable_declarator")
      .map((item) => item.childForFieldName("name") || firstIdentifier(item))
      .filter(Boolean);
  }
  const direct = node.childForFieldName("name");
  if (direct) {
    return [direct];
  }
  if (node.type === "function_definition") {
    const declarator = node.childForFieldName("declarator");
    const identifiers = declarator
      ? declarator.descendantsOfType([
          "identifier",
          "field_identifier"
        ])
      : [];
    return identifiers.length ? [identifiers[identifiers.length - 1]] : [];
  }
  return [];
}

function compactSignature(node) {
  const firstLine = node.text.split("\n")[0].replace(/\s+/g, " ").trim();
  return firstLine.length > 180
    ? `${firstLine.slice(0, 177)}...`
    : firstLine;
}

function extractIndex(file, tree) {
  const symbols = [];
  const references = [];
  const stack = [{ node: tree.rootNode, container: [] }];

  while (stack.length) {
    const item = stack.pop();
    const node = item.node;
    let container = item.container;
    const kind =
      DECLARATION_KINDS[node.type] ||
      (node.type === "field_declaration" ? "field" : null);
    const names = kind ? declarationNames(node) : [];

    for (const nameNode of names) {
      symbols.push({
        name: nameNode.text,
        kind,
        path: file.path,
        line: nameNode.startPosition.row + 1,
        column: nameNode.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        container: container.join("."),
        signature: compactSignature(node)
      });
    }

    if (IDENTIFIER_TYPES.has(node.type)) {
      references.push({
        name: node.text,
        path: file.path,
        line: node.startPosition.row + 1,
        column: node.startPosition.column + 1
      });
    }

    if (CONTAINER_TYPES.has(node.type) && names[0]) {
      container = [...container, names[0].text];
    }
    const children = node.namedChildren;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], container });
    }
  }
  return { symbols, references };
}

async function initialize(payload) {
  importScripts(payload.runtimeUrl);
  ParserClass = self.TreeSitter;
  await ParserClass.init({
    locateFile() {
      return payload.runtimeWasmUrl;
    }
  });
  parser = new ParserClass();
  for (const name of payload.parsers) {
    const language = await ParserClass.Language.load(
      `${payload.grammarBase}${name}.wasm`
    );
    languages.set(name, language);
  }
  postMessage({ type: "ready" });
}

async function indexFiles(payload) {
  const symbols = [];
  const references = [];
  const errors = [];
  let parsed = 0;
  for (const file of payload.files) {
    if (!file.parser || !languages.has(file.parser)) {
      continue;
    }
    try {
      parser.setLanguage(languages.get(file.parser));
      const tree = parser.parse(file.content);
      const result = extractIndex(file, tree);
      symbols.push(...result.symbols);
      references.push(...result.references);
      tree.delete();
      parsed += 1;
      postMessage({
        type: "progress",
        parsed,
        total: payload.files.filter((item) => item.parser).length,
        path: file.path
      });
    } catch (error) {
      errors.push({ path: file.path, message: error.message });
    }
  }
  postMessage({
    type: "indexed",
    symbols,
    references,
    errors,
    parsed
  });
}

self.onmessage = function (event) {
  const payload = event.data || {};
  const task =
    payload.type === "init"
      ? initialize(payload)
      : payload.type === "index"
        ? indexFiles(payload)
        : Promise.resolve();
  task.catch(function (error) {
    postMessage({
      type: "error",
      stage: payload.type,
      message: error.message || String(error)
    });
  });
};
