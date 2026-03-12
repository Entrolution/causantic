/**
 * Tests for regex-based fallback parser.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isRegexSupportedExtension, getRegexLanguageForExtension } from '../../src/repomap/regex-parser.js';
import { parseFile, isSupportedExtension, getLanguageForExtension } from '../../src/repomap/parser.js';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const FIXTURES_DIR = join(tmpdir(), 'causantic-regex-parser-test-' + process.pid);

describe('regex-parser', () => {
  beforeAll(() => {
    mkdirSync(FIXTURES_DIR, { recursive: true });

    // Scala fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.scala'),
      `
package com.example

import scala.collection.mutable.ListBuffer
import java.util.UUID

abstract class Animal(name: String) {
  def speak(): String
}

case class Dog(name: String, breed: String) extends Animal(name) {
  def speak(): String = s"$name barks"
}

sealed trait Shape
object Circle extends Shape
object Square extends Shape

trait Drawable {
  def draw(): Unit
}

object Helpers {
  def calculate(a: Int, b: Int): Int = a + b
  val defaultName: String = "unknown"
  type Callback = Int => Boolean
}
`,
    );

    // Kotlin fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.kt'),
      `
package com.example

import java.util.UUID
import kotlin.collections.HashMap

data class Point(val x: Double, val y: Double)

sealed class Result {
    data class Success(val value: Any) : Result()
    data class Error(val message: String) : Result()
}

interface Repository<T> {
    fun findById(id: String): T?
    fun save(item: T): T
}

object DatabaseConfig {
    val connectionString: String = "localhost"
}

fun calculate(a: Int, b: Int): Int = a + b

typealias Callback = (Int) -> Boolean

enum class Color { RED, GREEN, BLUE }
`,
    );

    // Swift fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.swift'),
      `
import Foundation
import UIKit

public class Animal {
    var name: String
    init(name: String) { self.name = name }
    func speak() -> String { return "" }
}

struct Point {
    var x: Double
    var y: Double
}

enum Color {
    case red, green, blue
}

protocol Drawable {
    func draw()
}

extension Animal: Drawable {
    func draw() {}
}

public func calculate(a: Int, b: Int) -> Int {
    return a + b
}

typealias Callback = (Int) -> Bool
`,
    );

    // Haskell fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.hs'),
      `
module Main where

import Data.Map
import qualified Data.List as L

data Color = Red | Green | Blue

newtype Wrapper a = Wrapper { unwrap :: a }

type Name = String

class Printable a where
  prettyPrint :: a -> String

calculate :: Int -> Int -> Int
calculate a b = a + b

fibonacci :: Int -> Int
fibonacci 0 = 0
fibonacci 1 = 1
fibonacci n = fibonacci (n - 1) + fibonacci (n - 2)
`,
    );

    // Lua fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.lua'),
      `
local json = require('cjson')
local utils = require "utils"

function greet(name)
    print("Hello, " .. name)
end

local function helper(x)
    return x * 2
end

local MyClass = {}
MyClass.__index = MyClass

function MyClass.new(name)
    local self = setmetatable({}, MyClass)
    self.name = name
    return self
end

function MyClass:getName()
    return self.name
end

callback = function(x)
    return x > 0
end
`,
    );

    // Dart fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.dart'),
      `
import 'package:flutter/material.dart';

abstract class Animal {
  String get name;
  void speak();
}

class Dog extends Animal {
  final String name;
  Dog(this.name);
  void speak() {
    print('Woof!');
  }
}

mixin Swimmer {
  void swim() {}
}

enum Color { red, green, blue }

typedef Callback = void Function(int);

extension StringHelper on String {
  String capitalize() => this[0].toUpperCase() + substring(1);
}
`,
    );

    // Zig fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.zig'),
      `
const std = @import("std");
const mem = @import("mem");

pub const Point = struct {
    x: f64,
    y: f64,
};

pub const Color = enum {
    red,
    green,
    blue,
};

pub const Result = union(enum) {
    ok: i32,
    err: []const u8,
};

pub fn calculate(a: i32, b: i32) i32 {
    return a + b;
}

fn helper(x: i32) i32 {
    return x * 2;
}
`,
    );

    // Elixir fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.ex'),
      `
defmodule MyApp.Animals do
  alias MyApp.Helpers
  import Enum

  defstruct [:name, :type]

  def speak(animal) do
    "#{animal.name} speaks"
  end

  defp format_name(name) do
    String.capitalize(name)
  end

  defmacro debug(expr) do
    quote do
      IO.inspect(unquote(expr))
    end
  end
end

defprotocol Printable do
  def to_string(data)
end

defmodule MyApp.Helpers do
  def calculate(a, b), do: a + b
end
`,
    );

    // Perl fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.pl'),
      `
#!/usr/bin/perl
use strict;
use warnings;
use JSON;
use Data::Dumper;

package Animal;

sub new {
    my ($class, %args) = @_;
    return bless \\%args, $class;
}

sub speak {
    my ($self) = @_;
    return $self->{name} . " speaks";
}

package main;

sub calculate {
    my ($a, $b) = @_;
    return $a + $b;
}
`,
    );

    // R fixture
    writeFileSync(
      join(FIXTURES_DIR, 'sample.r'),
      `
library(ggplot2)
require(dplyr)

calculate <- function(a, b) {
  a + b
}

process_data = function(df) {
  df %>% filter(value > 0)
}

# Simple constant
MAX_SIZE <- 100
`,
    );
  });

  afterAll(() => {
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  // --- Scala tests ---

  it('extracts class definitions from Scala', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.scala'), 'sample.scala');
    const classDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classDefs.some((d) => d.name === 'Animal')).toBe(true);
    expect(classDefs.some((d) => d.name === 'Dog')).toBe(true);
    expect(classDefs.some((d) => d.name === 'Circle')).toBe(true);
    expect(classDefs.some((d) => d.name === 'Helpers')).toBe(true);
  });

  it('extracts trait definitions from Scala', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.scala'), 'sample.scala');
    const traits = tags.filter((t) => t.kind === 'def' && t.type === 'interface');
    expect(traits.some((d) => d.name === 'Shape')).toBe(true);
    expect(traits.some((d) => d.name === 'Drawable')).toBe(true);
  });

  it('extracts function definitions from Scala', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.scala'), 'sample.scala');
    const fns = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fns.some((d) => d.name === 'speak')).toBe(true);
    expect(fns.some((d) => d.name === 'calculate')).toBe(true);
    expect(fns.some((d) => d.name === 'draw')).toBe(true);
  });

  it('extracts type definitions from Scala', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.scala'), 'sample.scala');
    const types = tags.filter((t) => t.kind === 'def' && t.type === 'type');
    expect(types.some((d) => d.name === 'Callback')).toBe(true);
  });

  it('extracts imports from Scala', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.scala'), 'sample.scala');
    const imports = tags.filter((t) => t.kind === 'ref' && t.type === 'import');
    expect(imports.some((d) => d.name === 'ListBuffer')).toBe(true);
    expect(imports.some((d) => d.name === 'UUID')).toBe(true);
  });

  // --- Kotlin tests ---

  it('extracts class definitions from Kotlin', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.kt'), 'sample.kt');
    const classDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classDefs.some((d) => d.name === 'Point')).toBe(true);
    expect(classDefs.some((d) => d.name === 'Result')).toBe(true);
    expect(classDefs.some((d) => d.name === 'DatabaseConfig')).toBe(true);
  });

  it('extracts interface definitions from Kotlin', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.kt'), 'sample.kt');
    const ifaces = tags.filter((t) => t.kind === 'def' && t.type === 'interface');
    expect(ifaces.some((d) => d.name === 'Repository')).toBe(true);
  });

  it('extracts function definitions from Kotlin', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.kt'), 'sample.kt');
    const fns = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fns.some((d) => d.name === 'calculate')).toBe(true);
  });

  it('extracts typealias from Kotlin', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.kt'), 'sample.kt');
    const types = tags.filter((t) => t.kind === 'def' && t.type === 'type');
    expect(types.some((d) => d.name === 'Callback')).toBe(true);
  });

  it('extracts imports from Kotlin', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.kt'), 'sample.kt');
    const imports = tags.filter((t) => t.kind === 'ref' && t.type === 'import');
    expect(imports.some((d) => d.name === 'UUID')).toBe(true);
    expect(imports.some((d) => d.name === 'HashMap')).toBe(true);
  });

  // --- Swift tests ---

  it('extracts class definitions from Swift', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.swift'), 'sample.swift');
    const classDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classDefs.some((d) => d.name === 'Animal')).toBe(true);
    expect(classDefs.some((d) => d.name === 'Point')).toBe(true);
  });

  it('extracts enum definitions from Swift', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.swift'), 'sample.swift');
    const enums = tags.filter((t) => t.kind === 'def' && t.type === 'enum');
    expect(enums.some((d) => d.name === 'Color')).toBe(true);
  });

  it('extracts protocol definitions from Swift', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.swift'), 'sample.swift');
    const protocols = tags.filter((t) => t.kind === 'def' && t.type === 'interface');
    expect(protocols.some((d) => d.name === 'Drawable')).toBe(true);
  });

  it('extracts function definitions from Swift', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.swift'), 'sample.swift');
    const fns = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fns.some((d) => d.name === 'calculate')).toBe(true);
  });

  it('extracts extension definitions from Swift', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.swift'), 'sample.swift');
    const exts = tags.filter((t) => t.kind === 'def' && t.name === 'Animal' && t.type === 'class');
    expect(exts.length).toBeGreaterThan(0);
  });

  it('extracts imports from Swift', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.swift'), 'sample.swift');
    const imports = tags.filter((t) => t.kind === 'ref' && t.type === 'import');
    expect(imports.some((d) => d.name === 'Foundation')).toBe(true);
    expect(imports.some((d) => d.name === 'UIKit')).toBe(true);
  });

  // --- Haskell tests ---

  it('extracts data type definitions from Haskell', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.hs'), 'sample.hs');
    const types = tags.filter((t) => t.kind === 'def' && t.type === 'type');
    expect(types.some((d) => d.name === 'Color')).toBe(true);
    expect(types.some((d) => d.name === 'Wrapper')).toBe(true);
    expect(types.some((d) => d.name === 'Name')).toBe(true);
  });

  it('extracts typeclass definitions from Haskell', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.hs'), 'sample.hs');
    const classes = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classes.some((d) => d.name === 'Printable')).toBe(true);
  });

  it('extracts function type signatures from Haskell', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.hs'), 'sample.hs');
    const fns = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fns.some((d) => d.name === 'calculate')).toBe(true);
    expect(fns.some((d) => d.name === 'fibonacci')).toBe(true);
  });

  it('extracts imports from Haskell', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.hs'), 'sample.hs');
    const imports = tags.filter((t) => t.kind === 'ref' && t.type === 'import');
    expect(imports.some((d) => d.name === 'Data.Map')).toBe(true);
    expect(imports.some((d) => d.name === 'Data.List')).toBe(true);
  });

  // --- Lua tests ---

  it('extracts function definitions from Lua', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.lua'), 'sample.lua');
    const fns = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fns.some((d) => d.name === 'greet')).toBe(true);
    expect(fns.some((d) => d.name === 'helper')).toBe(true);
    expect(fns.some((d) => d.name === 'MyClass.new')).toBe(true);
    expect(fns.some((d) => d.name === 'callback')).toBe(true);
  });

  it('extracts require imports from Lua', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.lua'), 'sample.lua');
    const imports = tags.filter((t) => t.kind === 'ref' && t.type === 'import');
    expect(imports.some((d) => d.name === 'json')).toBe(true);
    expect(imports.some((d) => d.name === 'utils')).toBe(true);
  });

  // --- Dart tests ---

  it('extracts class definitions from Dart', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.dart'), 'sample.dart');
    const classDefs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classDefs.some((d) => d.name === 'Animal')).toBe(true);
    expect(classDefs.some((d) => d.name === 'Dog')).toBe(true);
    expect(classDefs.some((d) => d.name === 'Swimmer')).toBe(true);
  });

  it('extracts enum definitions from Dart', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.dart'), 'sample.dart');
    const enums = tags.filter((t) => t.kind === 'def' && t.type === 'enum');
    expect(enums.some((d) => d.name === 'Color')).toBe(true);
  });

  it('extracts typedef from Dart', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.dart'), 'sample.dart');
    const types = tags.filter((t) => t.kind === 'def' && t.type === 'type');
    expect(types.some((d) => d.name === 'Callback')).toBe(true);
  });

  // --- Zig tests ---

  it('extracts function definitions from Zig', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.zig'), 'sample.zig');
    const fns = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fns.some((d) => d.name === 'calculate')).toBe(true);
    expect(fns.some((d) => d.name === 'helper')).toBe(true);
  });

  it('extracts struct definitions from Zig', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.zig'), 'sample.zig');
    const classes = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(classes.some((d) => d.name === 'Point')).toBe(true);
    expect(classes.some((d) => d.name === 'Result')).toBe(true);
  });

  it('extracts enum definitions from Zig', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.zig'), 'sample.zig');
    const enums = tags.filter((t) => t.kind === 'def' && t.type === 'enum');
    expect(enums.some((d) => d.name === 'Color')).toBe(true);
  });

  it('extracts @import references from Zig', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.zig'), 'sample.zig');
    const imports = tags.filter((t) => t.kind === 'ref' && t.type === 'import');
    expect(imports.some((d) => d.name === 'std')).toBe(true);
    expect(imports.some((d) => d.name === 'mem')).toBe(true);
  });

  // --- Elixir tests ---

  it('extracts module definitions from Elixir', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ex'), 'sample.ex');
    const mods = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(mods.some((d) => d.name === 'MyApp.Animals')).toBe(true);
    expect(mods.some((d) => d.name === 'MyApp.Helpers')).toBe(true);
  });

  it('extracts protocol definitions from Elixir', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ex'), 'sample.ex');
    const protos = tags.filter((t) => t.kind === 'def' && t.type === 'interface');
    expect(protos.some((d) => d.name === 'Printable')).toBe(true);
  });

  it('extracts function definitions from Elixir', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ex'), 'sample.ex');
    const fns = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fns.some((d) => d.name === 'speak')).toBe(true);
    expect(fns.some((d) => d.name === 'format_name')).toBe(true);
    expect(fns.some((d) => d.name === 'debug')).toBe(true);
    expect(fns.some((d) => d.name === 'calculate')).toBe(true);
  });

  it('extracts alias/import references from Elixir', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.ex'), 'sample.ex');
    const imports = tags.filter((t) => t.kind === 'ref' && t.type === 'import');
    expect(imports.some((d) => d.name === 'MyApp.Helpers')).toBe(true);
    expect(imports.some((d) => d.name === 'Enum')).toBe(true);
  });

  // --- Perl tests ---

  it('extracts sub definitions from Perl', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.pl'), 'sample.pl');
    const fns = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fns.some((d) => d.name === 'new')).toBe(true);
    expect(fns.some((d) => d.name === 'speak')).toBe(true);
    expect(fns.some((d) => d.name === 'calculate')).toBe(true);
  });

  it('extracts package definitions from Perl', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.pl'), 'sample.pl');
    const pkgs = tags.filter((t) => t.kind === 'def' && t.type === 'class');
    expect(pkgs.some((d) => d.name === 'Animal')).toBe(true);
    expect(pkgs.some((d) => d.name === 'main')).toBe(true);
  });

  it('extracts use imports from Perl', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.pl'), 'sample.pl');
    const imports = tags.filter((t) => t.kind === 'ref' && t.type === 'import');
    expect(imports.some((d) => d.name === 'strict')).toBe(true);
    expect(imports.some((d) => d.name === 'JSON')).toBe(true);
  });

  // --- R tests ---

  it('extracts function definitions from R', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.r'), 'sample.r');
    const fns = tags.filter((t) => t.kind === 'def' && t.type === 'function');
    expect(fns.some((d) => d.name === 'calculate')).toBe(true);
    expect(fns.some((d) => d.name === 'process_data')).toBe(true);
  });

  it('extracts library imports from R', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.r'), 'sample.r');
    const imports = tags.filter((t) => t.kind === 'ref' && t.type === 'import');
    expect(imports.some((d) => d.name === 'ggplot2')).toBe(true);
    expect(imports.some((d) => d.name === 'dplyr')).toBe(true);
  });

  // --- Integration: parseFile delegates to regex parser ---

  it('parseFile delegates to regex parser for .scala', async () => {
    const tags = await parseFile(join(FIXTURES_DIR, 'sample.scala'), 'sample.scala');
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.some((t) => t.kind === 'def')).toBe(true);
  });
});

describe('isRegexSupportedExtension', () => {
  it('recognizes Scala', () => {
    expect(isRegexSupportedExtension('.scala')).toBe(true);
    expect(isRegexSupportedExtension('.sc')).toBe(true);
  });

  it('recognizes Kotlin', () => {
    expect(isRegexSupportedExtension('.kt')).toBe(true);
    expect(isRegexSupportedExtension('.kts')).toBe(true);
  });

  it('recognizes Swift', () => {
    expect(isRegexSupportedExtension('.swift')).toBe(true);
  });

  it('recognizes Haskell', () => {
    expect(isRegexSupportedExtension('.hs')).toBe(true);
    expect(isRegexSupportedExtension('.lhs')).toBe(true);
  });

  it('recognizes Lua', () => {
    expect(isRegexSupportedExtension('.lua')).toBe(true);
  });

  it('recognizes Dart', () => {
    expect(isRegexSupportedExtension('.dart')).toBe(true);
  });

  it('recognizes Zig', () => {
    expect(isRegexSupportedExtension('.zig')).toBe(true);
  });

  it('recognizes Elixir', () => {
    expect(isRegexSupportedExtension('.ex')).toBe(true);
    expect(isRegexSupportedExtension('.exs')).toBe(true);
  });

  it('recognizes Perl', () => {
    expect(isRegexSupportedExtension('.pl')).toBe(true);
    expect(isRegexSupportedExtension('.pm')).toBe(true);
  });

  it('recognizes R', () => {
    expect(isRegexSupportedExtension('.r')).toBe(true);
    expect(isRegexSupportedExtension('.R')).toBe(true);
  });

  it('rejects non-regex-supported extensions', () => {
    expect(isRegexSupportedExtension('.ts')).toBe(false);
    expect(isRegexSupportedExtension('.py')).toBe(false);
    expect(isRegexSupportedExtension('.txt')).toBe(false);
  });
});

describe('getRegexLanguageForExtension', () => {
  it('maps Scala extensions', () => {
    expect(getRegexLanguageForExtension('.scala')).toBe('scala');
    expect(getRegexLanguageForExtension('.sc')).toBe('scala');
  });

  it('maps Kotlin extensions', () => {
    expect(getRegexLanguageForExtension('.kt')).toBe('kotlin');
  });

  it('maps Swift extensions', () => {
    expect(getRegexLanguageForExtension('.swift')).toBe('swift');
  });

  it('maps Haskell extensions', () => {
    expect(getRegexLanguageForExtension('.hs')).toBe('haskell');
  });

  it('returns undefined for tree-sitter-handled extensions', () => {
    expect(getRegexLanguageForExtension('.ts')).toBeUndefined();
    expect(getRegexLanguageForExtension('.rs')).toBeUndefined();
  });
});

describe('parser integration with regex fallback', () => {
  it('isSupportedExtension includes regex languages', () => {
    expect(isSupportedExtension('.scala')).toBe(true);
    expect(isSupportedExtension('.kt')).toBe(true);
    expect(isSupportedExtension('.swift')).toBe(true);
    expect(isSupportedExtension('.hs')).toBe(true);
    expect(isSupportedExtension('.lua')).toBe(true);
    expect(isSupportedExtension('.dart')).toBe(true);
    expect(isSupportedExtension('.zig')).toBe(true);
    expect(isSupportedExtension('.ex')).toBe(true);
    expect(isSupportedExtension('.pl')).toBe(true);
    expect(isSupportedExtension('.r')).toBe(true);
  });

  it('getLanguageForExtension returns regex language names', () => {
    expect(getLanguageForExtension('.scala')).toBe('scala');
    expect(getLanguageForExtension('.kt')).toBe('kotlin');
    expect(getLanguageForExtension('.swift')).toBe('swift');
    expect(getLanguageForExtension('.hs')).toBe('haskell');
    expect(getLanguageForExtension('.lua')).toBe('lua');
    expect(getLanguageForExtension('.dart')).toBe('dart');
    expect(getLanguageForExtension('.zig')).toBe('zig');
    expect(getLanguageForExtension('.ex')).toBe('elixir');
    expect(getLanguageForExtension('.pl')).toBe('perl');
    expect(getLanguageForExtension('.r')).toBe('r');
  });
});
