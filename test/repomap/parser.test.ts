/**
 * Tests for tree-sitter AST parser.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseFile, isSupportedExtension, getLanguageForExtension } from '../../src/repomap/parser.js';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const FIXTURES_DIR = join(tmpdir(), 'causantic-parser-test-' + process.pid);

describe('parseFile', () => {
  beforeAll(() => {
    mkdirSync(FIXTURES_DIR, { recursive: true });

    // TypeScript fixture with various definitions
    writeFileSync(
      join(FIXTURES_DIR, 'sample.ts'),
      `
import { Foo } from './foo.js';
import type { Bar } from './bar.js';

export interface MyInterface {
  name: string;
  value: number;
}

export type MyType = string | number;

export class MyClass implements MyInterface {
  name: string;
  value: number;

  constructor(name: string, value: number) {
    this.name = name;
    this.value = value;
  }

  getName(): string {
    return this.name;
  }
}

export function myFunction(input: MyType): MyClass {
  return new MyClass(String(input), 42);
}

export enum MyEnum {
  A = 'a',
  B = 'b',
}

export const myArrow = (x: number): number => x * 2;

const SIMPLE_CONST = 42;
`,
    );

    // JavaScript fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.js'),
      `
import { helper } from './helper.js';

class JsClass {
  constructor(name) {
    this.name = name;
  }

  greet() {
    return helper(this.name);
  }
}

function processData(data) {
  return data.map(item => item.value);
}

module.exports = { JsClass, processData };
`,
    );
  });

  afterAll(() => {
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  it('extracts class definitions from TypeScript', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ts'), 'sample.ts');
    const classDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classDefs.some((d) => d.name === 'MyClass')).toBe(true);
  });

  it('extracts interface definitions', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ts'), 'sample.ts');
    const interfaces = tags.filter((t) => t.kind === 'def' && t.type === 'interface');
    expect(interfaces.some((d) => d.name === 'MyInterface')).toBe(true);
  });

  it('extracts type alias definitions', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ts'), 'sample.ts');
    const types = tags.filter((t) => t.kind === 'def' && t.type === 'type');
    expect(types.some((d) => d.name === 'MyType')).toBe(true);
  });

  it('extracts function definitions', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ts'), 'sample.ts');
    const fns = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fns.some((d) => d.name === 'myFunction')).toBe(true);
  });

  it('extracts enum definitions', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ts'), 'sample.ts');
    const enums = tags.filter((t) => t.kind === 'def' && t.type === 'enum');
    expect(enums.some((d) => d.name === 'MyEnum')).toBe(true);
  });

  it('extracts arrow function variables', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ts'), 'sample.ts');
    const vars = tags.filter((t) => t.kind === 'def' && t.type === 'variable');
    expect(vars.some((d) => d.name === 'myArrow')).toBe(true);
  });

  it('filters out simple constant declarations', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ts'), 'sample.ts');
    const defs = tags.filter((t) => t.kind === 'def');
    // SIMPLE_CONST is a primitive assignment — should be filtered
    expect(defs.some((d) => d.name === 'SIMPLE_CONST')).toBe(false);
  });

  it('extracts import references', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ts'), 'sample.ts');
    const imports = tags.filter((t) => t.kind === 'ref' && t.type === 'import');
    expect(imports.some((d) => d.name === 'Foo')).toBe(true);
  });

  it('extracts type identifier references', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ts'), 'sample.ts');
    const typeRefs = tags.filter((t) => t.kind === 'ref' && t.type === 'identifier');
    expect(typeRefs.some((d) => d.name === 'MyInterface')).toBe(true);
    expect(typeRefs.some((d) => d.name === 'MyType')).toBe(true);
  });

  it('assigns correct line numbers', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ts'), 'sample.ts');
    for (const tag of tags) {
      expect(tag.line).toBeGreaterThan(0);
    }
  });

  it('assigns the file path to all tags', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ts'), 'sample.ts');
    for (const tag of tags) {
      expect(tag.file).toBe('sample.ts');
    }
  });

  it('parses JavaScript files', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.js'), 'sample.js');
    const classDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classDefs.some((d) => d.name === 'JsClass')).toBe(true);

    const fnDefs = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fnDefs.some((d) => d.name === 'processData')).toBe(true);
  });

  it('returns empty array for unsupported extensions', async () => {
    const tags = await parseFile('/fake/path.py', 'path.py');
    expect(tags).toEqual([]);
  });

  it('returns empty array for non-existent files', async () => {
    const tags = await parseFile('/non/existent.ts', 'non-existent.ts');
    expect(tags).toEqual([]);
  });
});

describe('isSupportedExtension', () => {
  it('recognizes TypeScript', () => {
    expect(isSupportedExtension('.ts')).toBe(true);
    expect(isSupportedExtension('.tsx')).toBe(true);
    expect(isSupportedExtension('.mts')).toBe(true);
  });

  it('recognizes JavaScript', () => {
    expect(isSupportedExtension('.js')).toBe(true);
    expect(isSupportedExtension('.jsx')).toBe(true);
    expect(isSupportedExtension('.mjs')).toBe(true);
  });

  it('rejects unsupported extensions', () => {
    expect(isSupportedExtension('.py')).toBe(false);
    expect(isSupportedExtension('.rs')).toBe(false);
    expect(isSupportedExtension('.go')).toBe(false);
  });
});

describe('getLanguageForExtension', () => {
  it('maps extensions to language names', () => {
    expect(getLanguageForExtension('.ts')).toBe('typescript');
    expect(getLanguageForExtension('.tsx')).toBe('tsx');
    expect(getLanguageForExtension('.js')).toBe('javascript');
  });

  it('returns undefined for unsupported', () => {
    expect(getLanguageForExtension('.py')).toBeUndefined();
  });
});
