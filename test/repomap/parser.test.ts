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

    // Python fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.py'),
      `
from typing import List, Optional
from dataclasses import dataclass

class Animal:
    def __init__(self, name: str):
        self.name = name

    def speak(self) -> str:
        return f"{self.name} speaks"

@dataclass
class Dog(Animal):
    breed: str

    def speak(self) -> str:
        return f"{self.name} barks"

def process_animals(animals: List[Animal]) -> List[str]:
    return [a.speak() for a in animals]

GLOBAL_CONST = 42
`,
    );

    // Java fixture
    writeFileSync(
      join(FIXTURES_DIR, 'Sample.java'),
      `
package com.example;

import java.util.List;
import java.util.ArrayList;

public class Sample {
    private String name;

    public Sample(String name) {
        this.name = name;
    }

    public String getName() {
        return this.name;
    }

    public static void main(String[] args) {
        Sample s = new Sample("test");
        List<String> items = new ArrayList<>();
    }
}

interface Processor {
    void process(String input);
}

enum Status {
    ACTIVE,
    INACTIVE
}
`,
    );

    // C fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.c'),
      `
#include <stdio.h>
#include <stdlib.h>

#define MAX_SIZE(n) ((n) * 2)

typedef struct {
    int x;
    int y;
} Point;

struct Node {
    int value;
    struct Node* next;
};

enum Color {
    RED,
    GREEN,
    BLUE
};

typedef int (*Callback)(int, int);

void print_point(Point* p) {
    printf("(%d, %d)\\n", p->x, p->y);
}

int add(int a, int b) {
    return a + b;
}

int main() {
    Point p = {1, 2};
    print_point(&p);
    return 0;
}
`,
    );

    // C++ fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.cpp'),
      `
#include <vector>
#include <string>

namespace geometry {

class Shape {
public:
    virtual double area() const = 0;
    virtual ~Shape() = default;
};

class Circle : public Shape {
private:
    double radius;
public:
    Circle(double r) : radius(r) {}
    double area() const override { return 3.14159 * radius * radius; }
};

template<typename T>
class Container {
    std::vector<T> items;
public:
    void add(const T& item) { items.push_back(item); }
    size_t size() const { return items.size(); }
};

struct Point {
    double x;
    double y;
};

enum class Color {
    Red,
    Green,
    Blue
};

} // namespace geometry

void process(geometry::Shape* shape) {
    double a = shape->area();
}
`,
    );
  });

  afterAll(() => {
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  // --- TypeScript tests ---

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

  // --- Python tests ---

  it('extracts class definitions from Python', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.py'), 'sample.py');
    const classDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classDefs.some((d) => d.name === 'Animal')).toBe(true);
  });

  it('extracts decorated class definitions from Python', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.py'), 'sample.py');
    const classDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classDefs.some((d) => d.name === 'Dog')).toBe(true);
  });

  it('extracts function definitions from Python', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.py'), 'sample.py');
    const fnDefs = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fnDefs.some((d) => d.name === 'process_animals')).toBe(true);
  });

  it('extracts method definitions from Python', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.py'), 'sample.py');
    const defs = tags.filter((t) => t.kind === 'def');
    // __init__ and speak are methods inside classes
    expect(defs.some((d) => d.name === '__init__')).toBe(true);
    expect(defs.some((d) => d.name === 'speak')).toBe(true);
  });

  it('extracts import references from Python', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.py'), 'sample.py');
    const imports = tags.filter((t) => t.kind === 'ref' && t.type === 'import');
    expect(imports.some((d) => d.name === 'List')).toBe(true);
    expect(imports.some((d) => d.name === 'Optional')).toBe(true);
    expect(imports.some((d) => d.name === 'dataclass')).toBe(true);
  });

  // --- Java tests ---

  it('extracts class definitions from Java', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'Sample.java'), 'Sample.java');
    const classDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classDefs.some((d) => d.name === 'Sample')).toBe(true);
  });

  it('extracts interface definitions from Java', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'Sample.java'), 'Sample.java');
    const interfaces = tags.filter((t) => t.kind === 'def' && t.type === 'interface');
    expect(interfaces.some((d) => d.name === 'Processor')).toBe(true);
  });

  it('extracts method definitions from Java', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'Sample.java'), 'Sample.java');
    const methods = tags.filter((t) => t.kind === 'def' && t.type === 'method');
    expect(methods.some((d) => d.name === 'getName')).toBe(true);
    expect(methods.some((d) => d.name === 'main')).toBe(true);
    // Constructor
    expect(methods.some((d) => d.name === 'Sample')).toBe(true);
  });

  it('extracts enum definitions from Java', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'Sample.java'), 'Sample.java');
    const enums = tags.filter((t) => t.kind === 'def' && t.type === 'enum');
    expect(enums.some((d) => d.name === 'Status')).toBe(true);
  });

  it('extracts import references from Java', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'Sample.java'), 'Sample.java');
    const imports = tags.filter((t) => t.kind === 'ref' && t.type === 'import');
    expect(imports.some((d) => d.name === 'List')).toBe(true);
    expect(imports.some((d) => d.name === 'ArrayList')).toBe(true);
  });

  // --- C tests ---

  it('extracts function definitions from C', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.c'), 'sample.c');
    const fnDefs = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fnDefs.some((d) => d.name === 'print_point')).toBe(true);
    expect(fnDefs.some((d) => d.name === 'add')).toBe(true);
    expect(fnDefs.some((d) => d.name === 'main')).toBe(true);
  });

  it('extracts struct definitions from C', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.c'), 'sample.c');
    const classDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classDefs.some((d) => d.name === 'Node')).toBe(true);
  });

  it('extracts enum definitions from C', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.c'), 'sample.c');
    const enums = tags.filter((t) => t.kind === 'def' && t.type === 'enum');
    expect(enums.some((d) => d.name === 'Color')).toBe(true);
  });

  it('extracts typedef definitions from C', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.c'), 'sample.c');
    const typeDefs = tags.filter((t) => t.kind === 'def' && t.type === 'type');
    expect(typeDefs.some((d) => d.name === 'Point')).toBe(true);
    expect(typeDefs.some((d) => d.name === 'Callback')).toBe(true);
  });

  it('extracts macro function definitions from C', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.c'), 'sample.c');
    const fnDefs = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fnDefs.some((d) => d.name === 'MAX_SIZE')).toBe(true);
  });

  // --- C++ tests ---

  it('extracts class definitions from C++', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.cpp'), 'sample.cpp');
    const classDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classDefs.some((d) => d.name === 'Shape')).toBe(true);
    expect(classDefs.some((d) => d.name === 'Circle')).toBe(true);
  });

  it('extracts template class definitions from C++', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.cpp'), 'sample.cpp');
    const classDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classDefs.some((d) => d.name === 'Container')).toBe(true);
  });

  it('extracts struct definitions from C++', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.cpp'), 'sample.cpp');
    const classDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classDefs.some((d) => d.name === 'Point')).toBe(true);
  });

  it('extracts namespace definitions from C++', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.cpp'), 'sample.cpp');
    const nsDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(nsDefs.some((d) => d.name === 'geometry')).toBe(true);
  });

  it('extracts enum class definitions from C++', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.cpp'), 'sample.cpp');
    const enums = tags.filter((t) => t.kind === 'def' && t.type === 'enum');
    expect(enums.some((d) => d.name === 'Color')).toBe(true);
  });

  it('extracts function definitions from C++', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.cpp'), 'sample.cpp');
    const fnDefs = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fnDefs.some((d) => d.name === 'process')).toBe(true);
  });

  // --- Common edge cases ---

  it('returns empty array for truly unsupported extensions', async () => {
    const tags = await parseFile('/fake/path.rs', 'path.rs');
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

  it('recognizes Python', () => {
    expect(isSupportedExtension('.py')).toBe(true);
    expect(isSupportedExtension('.pyi')).toBe(true);
  });

  it('recognizes Java', () => {
    expect(isSupportedExtension('.java')).toBe(true);
  });

  it('recognizes C', () => {
    expect(isSupportedExtension('.c')).toBe(true);
    expect(isSupportedExtension('.h')).toBe(true);
  });

  it('recognizes C++', () => {
    expect(isSupportedExtension('.cpp')).toBe(true);
    expect(isSupportedExtension('.cc')).toBe(true);
    expect(isSupportedExtension('.cxx')).toBe(true);
    expect(isSupportedExtension('.hpp')).toBe(true);
    expect(isSupportedExtension('.hh')).toBe(true);
    expect(isSupportedExtension('.hxx')).toBe(true);
  });

  it('rejects unsupported extensions', () => {
    expect(isSupportedExtension('.rs')).toBe(false);
    expect(isSupportedExtension('.go')).toBe(false);
    expect(isSupportedExtension('.rb')).toBe(false);
  });
});

describe('getLanguageForExtension', () => {
  it('maps TypeScript/JavaScript extensions', () => {
    expect(getLanguageForExtension('.ts')).toBe('typescript');
    expect(getLanguageForExtension('.tsx')).toBe('tsx');
    expect(getLanguageForExtension('.js')).toBe('javascript');
  });

  it('maps Python extensions', () => {
    expect(getLanguageForExtension('.py')).toBe('python');
    expect(getLanguageForExtension('.pyi')).toBe('python');
  });

  it('maps Java extensions', () => {
    expect(getLanguageForExtension('.java')).toBe('java');
  });

  it('maps C extensions', () => {
    // C files use the cpp grammar (no standalone tree-sitter-c.wasm)
    expect(getLanguageForExtension('.c')).toBe('cpp');
    expect(getLanguageForExtension('.h')).toBe('cpp');
  });

  it('maps C++ extensions', () => {
    expect(getLanguageForExtension('.cpp')).toBe('cpp');
    expect(getLanguageForExtension('.hpp')).toBe('cpp');
  });

  it('returns undefined for unsupported', () => {
    expect(getLanguageForExtension('.rs')).toBeUndefined();
  });
});
