/**
 * Tree-sitter AST parser for extracting definitions and references.
 *
 * Uses web-tree-sitter (WASM) to parse source files and extract:
 * - Definitions: classes, functions, methods, interfaces, type aliases, exports
 * - References: imports, identifiers used in code
 *
 * Supported languages: TypeScript, JavaScript, Python, Java, C, C++,
 * Rust, Go, Ruby, C#, PHP, Bash (tree-sitter).
 * Fallback regex parsing: Scala, Kotlin, Swift, Haskell, Lua, Dart,
 * Zig, Elixir, Perl, R.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Node as TSNode, Language as TSLanguage, Tree as TSTree } from 'web-tree-sitter';
import {
  parseFileRegex,
  isRegexSupportedExtension,
  getRegexLanguageForExtension,
} from './regex-parser.js';

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
  // TypeScript / JavaScript
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.jsx': 'javascript',
  // Python
  '.py': 'python',
  '.pyi': 'python',
  // Java
  '.java': 'java',
  // C (parsed with C++ grammar — no standalone tree-sitter-c.wasm in @vscode/tree-sitter-wasm)
  '.c': 'cpp',
  '.h': 'cpp',
  // C++
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
  // Rust
  '.rs': 'rust',
  // Go
  '.go': 'go',
  // Ruby
  '.rb': 'ruby',
  // C#
  '.cs': 'c-sharp',
  // PHP
  '.php': 'php',
  // Bash / Shell
  '.sh': 'bash',
  '.bash': 'bash',
};

// Lazy-loaded tree-sitter module and languages
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic tree-sitter import lacks typed exports
let ParserClass: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic tree-sitter import lacks typed exports
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import has no static type declarations
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

// ---------------------------------------------------------------------------
// Per-language definition node types
// ---------------------------------------------------------------------------

/** TypeScript / JavaScript / TSX definition types. */
const DEFINITION_TYPES_TS = new Set([
  'class_declaration',
  'abstract_class_declaration',
  'function_declaration',
  'generator_function_declaration',
  'method_definition',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'variable_declarator',
  'export_statement',
]);

/** Python definition types. */
const DEFINITION_TYPES_PYTHON = new Set([
  'class_definition',
  'function_definition',
  'decorated_definition',
]);

/** Java definition types. */
const DEFINITION_TYPES_JAVA = new Set([
  'class_declaration',
  'interface_declaration',
  'method_declaration',
  'enum_declaration',
  'constructor_declaration',
  'annotation_type_declaration',
]);

/** C++ definition types (also used for C files — C grammar not available as standalone WASM). */
const DEFINITION_TYPES_CPP = new Set([
  'function_definition',
  'struct_specifier',
  'class_specifier',
  'enum_specifier',
  'type_definition',
  'namespace_definition',
  'template_declaration',
  'preproc_function_def',
]);

/** Rust definition types. */
const DEFINITION_TYPES_RUST = new Set([
  'struct_item',
  'enum_item',
  'trait_item',
  'impl_item',
  'function_item',
  'type_item',
  'const_item',
  'static_item',
  'mod_item',
  'macro_definition',
]);

/** Go definition types. */
const DEFINITION_TYPES_GO = new Set([
  'type_declaration',
  'function_declaration',
  'method_declaration',
  'const_declaration',
  'var_declaration',
]);

/** Ruby definition types. */
const DEFINITION_TYPES_RUBY = new Set(['class', 'module', 'method', 'singleton_method']);

/** C# definition types. */
const DEFINITION_TYPES_CSHARP = new Set([
  'class_declaration',
  'interface_declaration',
  'struct_declaration',
  'enum_declaration',
  'method_declaration',
  'constructor_declaration',
  'namespace_declaration',
  'delegate_declaration',
]);

/** PHP definition types. */
const DEFINITION_TYPES_PHP = new Set([
  'class_declaration',
  'interface_declaration',
  'trait_declaration',
  'enum_declaration',
  'function_definition',
  'method_declaration',
]);

/** Bash definition types. */
const DEFINITION_TYPES_BASH = new Set(['function_definition']);

/** Lookup definition types by language. */
const DEFINITION_TYPES_BY_LANGUAGE: Record<string, Set<string>> = {
  typescript: DEFINITION_TYPES_TS,
  tsx: DEFINITION_TYPES_TS,
  javascript: DEFINITION_TYPES_TS,
  python: DEFINITION_TYPES_PYTHON,
  java: DEFINITION_TYPES_JAVA,
  cpp: DEFINITION_TYPES_CPP,
  rust: DEFINITION_TYPES_RUST,
  go: DEFINITION_TYPES_GO,
  ruby: DEFINITION_TYPES_RUBY,
  'c-sharp': DEFINITION_TYPES_CSHARP,
  php: DEFINITION_TYPES_PHP,
  bash: DEFINITION_TYPES_BASH,
};

// ---------------------------------------------------------------------------
// Name extraction
// ---------------------------------------------------------------------------

/**
 * Extract the name from a definition node.
 * Language-aware: handles different node structures per language.
 */
function extractDefinitionName(node: TSNode, languageName: string): string | null {
  // Most declarations have a 'name' field — try it first
  const nameNode = node.childForFieldName('name');
  if (nameNode) return nameNode.text;

  // TS/JS: variable_declarator — name is the first child
  if (node.type === 'variable_declarator') {
    const first = node.firstChild;
    if (first && (first.type === 'identifier' || first.type === 'type_identifier')) {
      return first.text;
    }
  }

  // Python: decorated_definition — unwrap to the inner definition
  if (node.type === 'decorated_definition') {
    const def = node.childForFieldName('definition');
    if (def) return extractDefinitionName(def, languageName);
  }

  // C/C++: function_definition — declarator → function_declarator → declarator (identifier)
  if (node.type === 'function_definition') {
    const declarator = node.childForFieldName('declarator');
    if (declarator) return extractFunctionDeclaratorName(declarator);
  }

  // C/C++: type_definition — declarator field holds the alias name
  if (node.type === 'type_definition') {
    const declarator = node.childForFieldName('declarator');
    if (declarator) {
      if (declarator.type === 'type_identifier' || declarator.type === 'identifier') {
        return declarator.text;
      }
      return extractFunctionDeclaratorName(declarator);
    }
  }

  // C/C++: struct_specifier, enum_specifier, class_specifier — name field (type_identifier)
  if (
    node.type === 'struct_specifier' ||
    node.type === 'enum_specifier' ||
    node.type === 'class_specifier'
  ) {
    // Some anonymous structs/enums don't have a name
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === 'type_identifier') return child.text;
    }
  }

  // C++: template_declaration — unwrap to the inner definition (skip keywords/punctuation)
  if (node.type === 'template_declaration') {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.isNamed && child.type !== 'template_parameter_list') {
        return extractDefinitionName(child, languageName);
      }
    }
  }

  // C: preproc_function_def — name field
  if (node.type === 'preproc_function_def') {
    const macroName = node.childForFieldName('name');
    if (macroName) return macroName.text;
  }

  // Java: constructor_declaration — name field
  if (node.type === 'constructor_declaration') {
    const ctorName = node.childForFieldName('name');
    if (ctorName) return ctorName.text;
  }

  // Go: type_declaration wraps type_spec — extract name from the inner spec
  if (node.type === 'type_declaration') {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === 'type_spec') {
        const specName = child.childForFieldName('name');
        if (specName) return specName.text;
      }
    }
  }

  // Go: const_declaration / var_declaration — extract from const_spec / var_spec
  if (node.type === 'const_declaration' || node.type === 'var_declaration') {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === 'const_spec' || child.type === 'var_spec') {
        const specName = child.childForFieldName('name');
        if (specName) return specName.text;
        // Fallback: first identifier child
        for (let j = 0; j < child.childCount; j++) {
          const grandchild = child.child(j)!;
          if (grandchild.type === 'identifier') return grandchild.text;
        }
      }
    }
  }

  // Ruby: class/module — name field is a constant node
  if (node.type === 'class' || node.type === 'module') {
    const n = node.childForFieldName('name');
    if (n) return n.text;
  }

  // Bash: function_definition — name field is a word node
  if (node.type === 'function_definition') {
    const n = node.childForFieldName('name');
    if (n) return n.text;
  }

  return null;
}

/**
 * Recursively extract the identifier name from a C/C++ function declarator chain.
 * Handles: function_declarator → declarator → identifier,
 *          pointer_declarator → declarator → identifier, etc.
 */
function extractFunctionDeclaratorName(node: TSNode): string | null {
  if (
    node.type === 'identifier' ||
    node.type === 'field_identifier' ||
    node.type === 'type_identifier'
  ) {
    return node.text;
  }
  // Handle qualified identifiers in C++ (namespace::name)
  if (node.type === 'qualified_identifier') {
    const nameChild = node.childForFieldName('name');
    if (nameChild) return nameChild.text;
  }
  const declarator = node.childForFieldName('declarator');
  if (declarator) return extractFunctionDeclaratorName(declarator);
  // Recurse into named children (parenthesized_declarator, pointer_declarator, etc.)
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.isNamed) {
      const name = extractFunctionDeclaratorName(child);
      if (name) return name;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Type categorization
// ---------------------------------------------------------------------------

/**
 * Get the definition type from a tree-sitter node type.
 */
function getDefinitionType(nodeType: string): Tag['type'] {
  switch (nodeType) {
    // TS/JS
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

    // Python
    case 'class_definition':
      return 'class';
    case 'function_definition':
      return 'function';
    case 'decorated_definition':
      return 'function'; // Will be overridden if inner def is a class

    // Java
    case 'method_declaration':
    case 'constructor_declaration':
      return 'method';
    case 'annotation_type_declaration':
      return 'interface';

    // C / C++
    case 'struct_specifier':
    case 'class_specifier':
      return 'class';
    case 'enum_specifier':
      return 'enum';
    case 'type_definition':
      return 'type';
    case 'namespace_definition':
      return 'class';
    case 'template_declaration':
      return 'class';
    case 'preproc_function_def':
      return 'function';

    // Rust
    case 'struct_item':
      return 'class';
    case 'enum_item':
      return 'enum';
    case 'trait_item':
      return 'interface';
    case 'impl_item':
      return 'class';
    case 'function_item':
      return 'function';
    case 'type_item':
      return 'type';
    case 'const_item':
    case 'static_item':
      return 'variable';
    case 'mod_item':
      return 'class';
    case 'macro_definition':
      return 'function';

    // Go (function_declaration, method_declaration, enum_declaration shared with TS/Java)
    case 'type_declaration':
      return 'type'; // refined in visitNode for struct/interface
    case 'const_declaration':
    case 'var_declaration':
      return 'variable';

    // Ruby
    case 'class':
      return 'class';
    case 'module':
      return 'class';
    case 'method':
    case 'singleton_method':
      return 'method';

    // C#
    case 'struct_declaration':
      return 'class';
    case 'delegate_declaration':
      return 'type';
    case 'namespace_declaration':
      return 'class';

    // PHP
    case 'trait_declaration':
      return 'class';

    // Bash
    // function_definition already handled by C/C++ case above

    default:
      return 'variable';
  }
}

/**
 * Refine the type for Python decorated definitions based on the inner node.
 */
function getDecoratedDefinitionType(node: TSNode): Tag['type'] {
  const def = node.childForFieldName('definition');
  if (def) return getDefinitionType(def.type);
  return 'function';
}

// ---------------------------------------------------------------------------
// Variable interest filter (TS/JS only)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

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

  // Fall back to regex parser for languages without tree-sitter grammars
  if (!languageName) {
    return parseFileRegex(filePath, relativePath);
  }

  const defTypes = DEFINITION_TYPES_BY_LANGUAGE[languageName];
  if (!defTypes) return [];

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
  const isTS =
    languageName === 'typescript' || languageName === 'tsx' || languageName === 'javascript';

  // Walk the tree to extract definitions
  const cursor = tree.walk();
  const visitNode = (): void => {
    const node = cursor.currentNode;

    // Extract definitions
    if (defTypes.has(node.type)) {
      // TS/JS: export_statement — look at the child declaration
      if (node.type === 'export_statement') {
        const declaration = node.childForFieldName('declaration');
        if (declaration) {
          if (defTypes.has(declaration.type)) {
            const name = extractDefinitionName(declaration, languageName);
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
                const name = extractDefinitionName(child, languageName);
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

      // Python: decorated_definition — unwrap
      if (node.type === 'decorated_definition') {
        const name = extractDefinitionName(node, languageName);
        if (name && name.length > 1) {
          tags.push({
            name,
            kind: 'def',
            line: node.startPosition.row + 1,
            file: relativePath,
            type: getDecoratedDefinitionType(node),
          });
          definedNames.add(name);
        }
        // Don't recurse into the decorated definition — we extracted the inner name
        return;
      }

      // C++: template_declaration — unwrap
      if (node.type === 'template_declaration') {
        const name = extractDefinitionName(node, languageName);
        if (name && name.length > 1) {
          // Determine type from inner declaration
          let innerType: Tag['type'] = 'class';
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)!;
            if (child.isNamed && child.type !== 'template_parameter_list') {
              innerType = getDefinitionType(child.type);
              break;
            }
          }
          tags.push({
            name,
            kind: 'def',
            line: node.startPosition.row + 1,
            file: relativePath,
            type: innerType,
          });
          definedNames.add(name);
        }
        return;
      }

      // TS/JS: skip boring variable declarations (primitives, simple assignments)
      if (node.type === 'variable_declarator' && !isInterestingVariable(node)) {
        return;
      }

      // Go: type_declaration — refine type based on inner type_spec
      if (node.type === 'type_declaration') {
        const name = extractDefinitionName(node, languageName);
        if (name && name.length > 1) {
          let defType: Tag['type'] = 'type';
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)!;
            if (child.type === 'type_spec') {
              const typeField = child.childForFieldName('type');
              if (typeField) {
                if (typeField.type === 'struct_type') defType = 'class';
                else if (typeField.type === 'interface_type') defType = 'interface';
              }
              break;
            }
          }
          tags.push({
            name,
            kind: 'def',
            line: node.startPosition.row + 1,
            file: relativePath,
            type: defType,
          });
          definedNames.add(name);
        }
        return;
      }

      // Rust: impl_item — extract trait and type names for references
      if (node.type === 'impl_item') {
        // Don't add impl as a definition (it's not a named symbol)
        // but extract type references from it
        return;
      }

      const name = extractDefinitionName(node, languageName);
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

    // Extract import references (TS/JS)
    if (isTS && node.type === 'import_specifier') {
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

    // Extract import references (Python)
    if (languageName === 'python') {
      // from X import name1, name2 — capture the imported names
      if (node.type === 'import_from_statement') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!;
          if (child.type === 'dotted_name' && i > 1) {
            // Imported name (after 'from X import')
            const name = child.text;
            if (name && name.length > 1) {
              tags.push({
                name,
                kind: 'ref',
                line: child.startPosition.row + 1,
                file: relativePath,
                type: 'import',
              });
            }
          }
          if (child.type === 'aliased_import') {
            const nameChild = child.childForFieldName('name');
            if (nameChild && nameChild.text.length > 1) {
              tags.push({
                name: nameChild.text,
                kind: 'ref',
                line: nameChild.startPosition.row + 1,
                file: relativePath,
                type: 'import',
              });
            }
          }
        }
      }
    }

    // Extract import references (Java)
    if (languageName === 'java' && node.type === 'import_declaration') {
      // import com.example.ClassName; — capture the last identifier
      const lastChild = findLastIdentifier(node);
      if (lastChild && lastChild.length > 1) {
        tags.push({
          name: lastChild,
          kind: 'ref',
          line: node.startPosition.row + 1,
          file: relativePath,
          type: 'import',
        });
      }
    }

    // Extract import references (Rust)
    if (languageName === 'rust' && node.type === 'use_declaration') {
      collectRustUseIdentifiers(node, relativePath, tags);
    }

    // Extract import references (Go)
    if (languageName === 'go' && node.type === 'import_declaration') {
      collectGoImportIdentifiers(node, relativePath, tags);
    }

    // Extract import references (C#)
    if (languageName === 'c-sharp' && node.type === 'using_directive') {
      const lastId = findLastNameInTree(node);
      if (lastId && lastId.length > 1) {
        tags.push({
          name: lastId,
          kind: 'ref',
          line: node.startPosition.row + 1,
          file: relativePath,
          type: 'import',
        });
      }
    }

    // Extract import references (PHP)
    if (languageName === 'php' && node.type === 'namespace_use_declaration') {
      collectPhpUseIdentifiers(node, relativePath, tags);
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
  collectReferences(tree.rootNode, relativePath, definedNames, tags, languageName);

  tree.delete();
  parser.delete();

  return tags;
}

/**
 * Find the last identifier in a node's children (for Java import declarations).
 */
function findLastIdentifier(node: TSNode): string | null {
  let last: string | null = null;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === 'identifier') {
      last = child.text;
    }
    // Java scoped identifiers: com.example.ClassName
    if (child.type === 'scoped_identifier') {
      const nameChild = child.childForFieldName('name');
      if (nameChild) last = nameChild.text;
    }
  }
  return last;
}

/**
 * Find the deepest last identifier in a node tree (for C# qualified_name chains).
 */
function findLastNameInTree(node: TSNode): string | null {
  let last: string | null = null;
  function walk(n: TSNode): void {
    if (n.type === 'identifier') last = n.text;
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  }
  walk(node);
  return last;
}

/**
 * Collect identifiers from a Rust use declaration.
 * Handles: use crate::module::{Foo, Bar}; use std::collections::HashMap;
 */
function collectRustUseIdentifiers(node: TSNode, relativePath: string, tags: Tag[]): void {
  // Walk children but only the last identifier in a path is the import name
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === 'scoped_identifier') {
      // use std::collections::HashMap → only HashMap
      let deepest: TSNode = child;
      while (deepest.childForFieldName('name')) {
        const next = deepest.childForFieldName('name')!;
        if (next.type === 'scoped_identifier') {
          deepest = next;
          continue;
        }
        if (next.text.length > 1) {
          tags.push({
            name: next.text,
            kind: 'ref',
            line: next.startPosition.row + 1,
            file: relativePath,
            type: 'import',
          });
        }
        break;
      }
    }
    if (child.type === 'scoped_use_list') {
      // use crate::module::{Foo, Bar}
      for (let j = 0; j < child.childCount; j++) {
        const listChild = child.child(j)!;
        if (listChild.type === 'use_list') {
          for (let k = 0; k < listChild.childCount; k++) {
            const item = listChild.child(k)!;
            if (item.type === 'identifier' && item.text.length > 1) {
              tags.push({
                name: item.text,
                kind: 'ref',
                line: item.startPosition.row + 1,
                file: relativePath,
                type: 'import',
              });
            }
          }
        }
      }
    }
  }
}

/**
 * Collect imported package names from a Go import declaration.
 * Go imports are strings like "fmt" — extract the last path component.
 */
function collectGoImportIdentifiers(node: TSNode, relativePath: string, tags: Tag[]): void {
  function extractFromSpec(spec: TSNode): void {
    for (let i = 0; i < spec.childCount; i++) {
      const child = spec.child(i)!;
      if (child.type === 'interpreted_string_literal') {
        // Extract last path component: "github.com/pkg/errors" → "errors"
        const content = child.text.replace(/"/g, '');
        const parts = content.split('/');
        const name = parts[parts.length - 1];
        if (name && name.length > 1) {
          tags.push({
            name,
            kind: 'ref',
            line: child.startPosition.row + 1,
            file: relativePath,
            type: 'import',
          });
        }
      }
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === 'import_spec') extractFromSpec(child);
    if (child.type === 'import_spec_list') {
      for (let j = 0; j < child.childCount; j++) {
        const spec = child.child(j)!;
        if (spec.type === 'import_spec') extractFromSpec(spec);
      }
    }
  }
}

/**
 * Collect class/interface names from a PHP use declaration.
 * use App\Base\Model → "Model"
 */
function collectPhpUseIdentifiers(node: TSNode, relativePath: string, tags: Tag[]): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === 'namespace_use_clause') {
      // Get the last name in the qualified_name
      for (let j = 0; j < child.childCount; j++) {
        const qn = child.child(j)!;
        if (qn.type === 'qualified_name') {
          // Last name child is the class name
          let lastName: string | null = null;
          let lastLine = 0;
          for (let k = 0; k < qn.childCount; k++) {
            const part = qn.child(k)!;
            if (part.type === 'name') {
              lastName = part.text;
              lastLine = part.startPosition.row + 1;
            }
          }
          if (lastName && lastName.length > 1) {
            tags.push({
              name: lastName,
              kind: 'ref',
              line: lastLine,
              file: relativePath,
              type: 'import',
            });
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Reference collection
// ---------------------------------------------------------------------------

/**
 * Collect reference identifiers from the AST.
 * Looks for type references, call expressions, and constructor invocations.
 */
function collectReferences(
  rootNode: TSNode,
  relativePath: string,
  localNames: Set<string>,
  tags: Tag[],
  languageName: string,
): void {
  const seenRefs = new Set<string>();

  function addRef(name: string, line: number): void {
    if (name.length > 1 && !seenRefs.has(name)) {
      seenRefs.add(name);
      tags.push({ name, kind: 'ref', line, file: relativePath, type: 'identifier' });
    }
  }

  function walk(node: TSNode): void {
    // Type references (TS/JS/Java/C/C++: type_identifier)
    if (node.type === 'type_identifier') {
      addRef(node.text, node.startPosition.row + 1);
    }

    // Call expressions (TS/JS/C/C++)
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn) {
        if (fn.type === 'identifier') {
          if (!localNames.has(fn.text)) addRef(fn.text, fn.startPosition.row + 1);
        }
        if (fn.type === 'member_expression' || fn.type === 'field_expression') {
          const obj = fn.childForFieldName('object') ?? fn.childForFieldName('argument');
          if (obj && obj.type === 'identifier' && !localNames.has(obj.text)) {
            addRef(obj.text, obj.startPosition.row + 1);
          }
        }
      }
    }

    // Python calls
    if (node.type === 'call') {
      const fn = node.childForFieldName('function');
      if (fn) {
        if (fn.type === 'identifier' && !localNames.has(fn.text)) {
          addRef(fn.text, fn.startPosition.row + 1);
        }
        if (fn.type === 'attribute') {
          const obj = fn.childForFieldName('object');
          if (obj && obj.type === 'identifier' && !localNames.has(obj.text)) {
            addRef(obj.text, obj.startPosition.row + 1);
          }
        }
      }
    }

    // Java: method invocations
    if (node.type === 'method_invocation') {
      const obj = node.childForFieldName('object');
      if (obj && obj.type === 'identifier' && !localNames.has(obj.text)) {
        addRef(obj.text, obj.startPosition.row + 1);
      }
    }

    // Java: object creation (new ClassName())
    if (node.type === 'object_creation_expression') {
      const typeNode = node.childForFieldName('type');
      if (typeNode && typeNode.type === 'type_identifier') {
        addRef(typeNode.text, typeNode.startPosition.row + 1);
      }
    }

    // TS/JS/C++: new expressions
    if (node.type === 'new_expression') {
      const constructor = node.childForFieldName('constructor');
      if (constructor && constructor.type === 'identifier') {
        addRef(constructor.text, constructor.startPosition.row + 1);
      }
    }

    // Rust: macro invocations (macro_name!)
    if (node.type === 'macro_invocation') {
      const macroNode = node.childForFieldName('macro');
      if (macroNode && macroNode.type === 'identifier' && !localNames.has(macroNode.text)) {
        addRef(macroNode.text, macroNode.startPosition.row + 1);
      }
    }

    // Go: composite literals (Point{...})
    if (node.type === 'composite_literal') {
      const typeNode = node.childForFieldName('type');
      if (typeNode && typeNode.type === 'type_identifier' && !localNames.has(typeNode.text)) {
        addRef(typeNode.text, typeNode.startPosition.row + 1);
      }
    }

    // Go: selector expressions (pkg.Function)
    if (node.type === 'selector_expression') {
      const operand = node.childForFieldName('operand');
      if (operand && operand.type === 'identifier' && !localNames.has(operand.text)) {
        addRef(operand.text, operand.startPosition.row + 1);
      }
    }

    // C#: object_creation_expression (new ClassName())
    if (node.type === 'object_creation_expression' && languageName === 'c-sharp') {
      const typeNode = node.childForFieldName('type');
      if (typeNode && typeNode.type === 'identifier') {
        addRef(typeNode.text, typeNode.startPosition.row + 1);
      }
    }

    // Recurse
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i)!);
    }
  }

  walk(rootNode);
}

// ---------------------------------------------------------------------------
// Public utilities
// ---------------------------------------------------------------------------

/**
 * Get the language name for a file extension.
 * Checks tree-sitter languages first, then regex-based fallback languages.
 */
export function getLanguageForExtension(ext: string): string | undefined {
  return EXTENSION_TO_LANGUAGE[ext] ?? getRegexLanguageForExtension(ext);
}

/**
 * Check if a file extension is supported (tree-sitter or regex fallback).
 */
export function isSupportedExtension(ext: string): boolean {
  return ext in EXTENSION_TO_LANGUAGE || isRegexSupportedExtension(ext);
}
