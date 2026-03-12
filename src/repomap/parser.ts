/**
 * Tree-sitter AST parser for extracting definitions and references.
 *
 * Uses web-tree-sitter (WASM) to parse source files and extract:
 * - Definitions: classes, functions, methods, interfaces, type aliases, exports
 * - References: imports, identifiers used in code
 *
 * Phase 1a: TypeScript, TSX, JavaScript, JSX only.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Node as TSNode, Language as TSLanguage, Tree as TSTree } from 'web-tree-sitter';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** A tag extracted from a source file. */
export interface Tag {
  /** The symbol name (e.g., 'MyClass', 'myFunction'). */
  name: string;
  /** Whether this is a definition or reference. */
  kind: 'def' | 'ref';
  /** Line number (1-based). */
  line: number;
  /** The file this tag belongs to (relative path). */
  file: string;
  /** Specific type of definition/reference. */
  type:
    | 'class'
    | 'function'
    | 'method'
    | 'interface'
    | 'type'
    | 'enum'
    | 'variable'
    | 'export'
    | 'import'
    | 'identifier';
}

/** Map from file extension to tree-sitter language name. */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.jsx': 'javascript',
};

// Lazy-loaded tree-sitter module and languages
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ParserClass: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let LanguageClass: any = null;
let initPromise: Promise<void> | null = null;
const languageCache = new Map<string, TSLanguage>();

/**
 * Initialize tree-sitter. Must be called before parsing.
 * Idempotent — safe to call multiple times.
 */
async function ensureInit(): Promise<void> {
  if (ParserClass) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('web-tree-sitter')) as any;
    const P = mod.Parser ?? mod.default;
    const wasmPath = join(
      __dirname,
      '..',
      '..',
      'node_modules',
      'web-tree-sitter',
      'web-tree-sitter.wasm',
    );
    await P.init({ locateFile: () => wasmPath });
    ParserClass = P;
    LanguageClass = mod.Language;
  })();

  return initPromise;
}

/**
 * Load a tree-sitter language grammar.
 */
async function loadLanguage(languageName: string): Promise<TSLanguage> {
  const cached = languageCache.get(languageName);
  if (cached) return cached;

  await ensureInit();

  // Resolve the WASM file from @vscode/tree-sitter-wasm
  const wasmFile = `tree-sitter-${languageName}.wasm`;
  const wasmPath = join(
    __dirname,
    '..',
    '..',
    'node_modules',
    '@vscode',
    'tree-sitter-wasm',
    'wasm',
    wasmFile,
  );

  const language = await LanguageClass.load(wasmPath);
  languageCache.set(languageName, language);
  return language;
}

/** Node types that define symbols in TypeScript/JavaScript. */
const DEFINITION_TYPES = new Set([
  // Declarations
  'class_declaration',
  'abstract_class_declaration',
  'function_declaration',
  'generator_function_declaration',
  'method_definition',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'variable_declarator',
  // Exports with names
  'export_statement',
]);

/**
 * Extract the name from a definition node.
 */
function extractDefinitionName(node: TSNode): string | null {
  // Most declarations have a 'name' field
  const nameNode = node.childForFieldName('name');
  if (nameNode) return nameNode.text;

  // For variable_declarator, the name is the first child
  if (node.type === 'variable_declarator') {
    const first = node.firstChild;
    if (first && (first.type === 'identifier' || first.type === 'type_identifier')) {
      return first.text;
    }
  }

  return null;
}

/**
 * Get the definition type from a tree-sitter node type.
 */
function getDefinitionType(nodeType: string): Tag['type'] {
  switch (nodeType) {
    case 'class_declaration':
    case 'abstract_class_declaration':
      return 'class';
    case 'function_declaration':
    case 'generator_function_declaration':
      return 'function';
    case 'method_definition':
      return 'method';
    case 'interface_declaration':
      return 'interface';
    case 'type_alias_declaration':
      return 'type';
    case 'enum_declaration':
      return 'enum';
    case 'variable_declarator':
      return 'variable';
    case 'export_statement':
      return 'export';
    default:
      return 'variable';
  }
}

/**
 * Check if a variable declarator is "interesting" (arrow function, class expression, etc.)
 * Filters out simple primitives to reduce noise.
 */
function isInterestingVariable(node: TSNode): boolean {
  const value = node.childForFieldName('value');
  if (!value) return true; // Declaration without value is interesting
  switch (value.type) {
    case 'arrow_function':
    case 'function_expression':
    case 'class':
    case 'call_expression':
    case 'new_expression':
    case 'object':
    case 'array':
      return true;
    default:
      return false;
  }
}

/**
 * Parse a source file and extract tags (definitions + references).
 *
 * @param filePath - Absolute path to the source file
 * @param relativePath - Relative path for tag metadata
 * @returns Array of tags extracted from the file
 */
export async function parseFile(filePath: string, relativePath: string): Promise<Tag[]> {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  const languageName = EXTENSION_TO_LANGUAGE[ext];
  if (!languageName) return [];

  await ensureInit();
  const language = await loadLanguage(languageName);

  const parser = new ParserClass();
  parser.setLanguage(language);

  let source: string;
  try {
    source = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const tree = parser.parse(source) as TSTree | null;
  if (!tree) {
    parser.delete();
    return [];
  }

  const tags: Tag[] = [];
  const definedNames = new Set<string>();

  // Walk the tree to extract definitions
  const cursor = tree.walk();
  const visitNode = (): void => {
    const node = cursor.currentNode;

    // Extract definitions
    if (DEFINITION_TYPES.has(node.type)) {
      // For export_statement, look at the child declaration
      if (node.type === 'export_statement') {
        const declaration = node.childForFieldName('declaration');
        if (declaration) {
          if (DEFINITION_TYPES.has(declaration.type)) {
            const name = extractDefinitionName(declaration);
            if (name && name.length > 1) {
              tags.push({
                name,
                kind: 'def',
                line: declaration.startPosition.row + 1,
                file: relativePath,
                type: getDefinitionType(declaration.type),
              });
              definedNames.add(name);
            }
          } else if (
            declaration.type === 'lexical_declaration' ||
            declaration.type === 'variable_declaration'
          ) {
            // export const/let/var — recurse into variable_declarator children
            for (let i = 0; i < declaration.childCount; i++) {
              const child = declaration.child(i)!;
              if (child.type === 'variable_declarator' && isInterestingVariable(child)) {
                const name = extractDefinitionName(child);
                if (name && name.length > 1) {
                  tags.push({
                    name,
                    kind: 'def',
                    line: child.startPosition.row + 1,
                    file: relativePath,
                    type: getDefinitionType(child.type),
                  });
                  definedNames.add(name);
                }
              }
            }
          }
        }
        // Don't recurse further into the export statement for this branch
        return;
      }

      // Skip boring variable declarations (primitives, simple assignments)
      if (node.type === 'variable_declarator' && !isInterestingVariable(node)) {
        return;
      }

      const name = extractDefinitionName(node);
      if (name && name.length > 1) {
        tags.push({
          name,
          kind: 'def',
          line: node.startPosition.row + 1,
          file: relativePath,
          type: getDefinitionType(node.type),
        });
        definedNames.add(name);
      }
    }

    // Extract import references
    if (node.type === 'import_specifier') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode?.text ?? node.firstChild?.text;
      if (name && name.length > 1) {
        tags.push({
          name,
          kind: 'ref',
          line: node.startPosition.row + 1,
          file: relativePath,
          type: 'import',
        });
      }
    }

    // Recurse into children
    if (cursor.gotoFirstChild()) {
      do {
        visitNode();
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  };

  visitNode();

  // Second pass: collect identifier references (type references, call expressions)
  // These are references to symbols that are defined elsewhere
  collectReferences(tree.rootNode, relativePath, definedNames, tags);

  tree.delete();
  parser.delete();

  return tags;
}

/**
 * Collect reference identifiers from the AST.
 * We look for type_identifier and identifier nodes in specific contexts
 * that indicate cross-file references.
 */
function collectReferences(
  rootNode: TSNode,
  relativePath: string,
  localNames: Set<string>,
  tags: Tag[],
): void {
  const seenRefs = new Set<string>();

  function walk(node: TSNode): void {
    // Type references (e.g., `: MyType`, `<MyType>`, `implements MyInterface`)
    if (node.type === 'type_identifier') {
      const name = node.text;
      if (name.length > 1 && !seenRefs.has(name)) {
        seenRefs.add(name);
        tags.push({
          name,
          kind: 'ref',
          line: node.startPosition.row + 1,
          file: relativePath,
          type: 'identifier',
        });
      }
    }

    // Call expressions: the function being called
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn) {
        // Direct calls: foo()
        if (fn.type === 'identifier') {
          const name = fn.text;
          if (name.length > 1 && !seenRefs.has(name) && !localNames.has(name)) {
            seenRefs.add(name);
            tags.push({
              name,
              kind: 'ref',
              line: fn.startPosition.row + 1,
              file: relativePath,
              type: 'identifier',
            });
          }
        }
        // Member calls: obj.method() — capture the object
        if (fn.type === 'member_expression') {
          const obj = fn.childForFieldName('object');
          if (obj && obj.type === 'identifier') {
            const name = obj.text;
            if (name.length > 1 && !seenRefs.has(name) && !localNames.has(name)) {
              seenRefs.add(name);
              tags.push({
                name,
                kind: 'ref',
                line: obj.startPosition.row + 1,
                file: relativePath,
                type: 'identifier',
              });
            }
          }
        }
      }
    }

    // new expressions: new Foo()
    if (node.type === 'new_expression') {
      const constructor = node.childForFieldName('constructor');
      if (constructor && constructor.type === 'identifier') {
        const name = constructor.text;
        if (name.length > 1 && !seenRefs.has(name)) {
          seenRefs.add(name);
          tags.push({
            name,
            kind: 'ref',
            line: constructor.startPosition.row + 1,
            file: relativePath,
            type: 'identifier',
          });
        }
      }
    }

    // Recurse
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i)!);
    }
  }

  walk(rootNode);
}

/**
 * Get the language name for a file extension.
 */
export function getLanguageForExtension(ext: string): string | undefined {
  return EXTENSION_TO_LANGUAGE[ext];
}

/**
 * Check if a file extension is supported.
 */
export function isSupportedExtension(ext: string): boolean {
  return ext in EXTENSION_TO_LANGUAGE;
}
