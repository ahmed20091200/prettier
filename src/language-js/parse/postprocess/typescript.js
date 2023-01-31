import isNonEmptyArray from "../../../utils/is-non-empty-array.js";
import visitNode from "./visit-node.js";
import throwTsSyntaxError from "./throw-ts-syntax-error.js";

let ts;

function getTsNodeLocation(nodeOrToken) {
  const sourceFile = ts.getSourceFileOfNode(nodeOrToken);
  const position = ts.rangeOfNode(nodeOrToken);
  const [start, end] = [position.pos, position.end].map((position) => {
    const { line, character: column } =
      sourceFile.getLineAndCharacterOfPosition(position);
    return { line: line + 1, column };
  });

  return { start, end };
}

function throwErrorOnTsNode(node, message) {
  throwTsSyntaxError({ loc: getTsNodeLocation(node) }, message);
}

// Invalid decorators are removed since `@typescript-eslint/typescript-estree` v4
// https://github.com/typescript-eslint/typescript-eslint/pull/2375
// There is a `checkGrammarDecorators` in `typescript` package, consider use it directly in future
function throwErrorForInvalidDecorator(tsNode) {
  const { illegalDecorators } = tsNode;
  if (!isNonEmptyArray(illegalDecorators)) {
    return;
  }

  const [{ expression }] = illegalDecorators;

  throwErrorOnTsNode(expression, "Decorators are not valid here.");
}

// Values of abstract property is removed since `@typescript-eslint/typescript-estree` v5
// https://github.com/typescript-eslint/typescript-eslint/releases/tag/v5.0.0
function throwErrorForInvalidAbstractProperty(tsNode, esTreeNode) {
  if (
    !(
      tsNode.kind === ts.SyntaxKind.PropertyDeclaration &&
      tsNode.initializer &&
      esTreeNode.value === null &&
      tsNode.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword
      )
    )
  ) {
    return;
  }

  throwTsSyntaxError(
    esTreeNode,
    "Abstract property cannot have an initializer"
  );
}

// Based on `checkGrammarModifiers` function in `typescript`
function throwErrorForInvalidModifier(node) {
  const { modifiers } = node;
  if (!isNonEmptyArray(modifiers)) {
    return;
  }

  const { SyntaxKind } = ts;

  for (const modifier of modifiers) {
    if (ts.isDecorator(modifier)) {
      continue;
    }

    if (modifier.kind !== SyntaxKind.ReadonlyKeyword) {
      if (
        node.kind === SyntaxKind.PropertySignature ||
        node.kind === SyntaxKind.MethodSignature
      ) {
        throwErrorOnTsNode(
          modifier,
          `'${ts.tokenToString(
            modifier.kind
          )}' modifier cannot appear on a type member`
        );
      }

      if (
        node.kind === SyntaxKind.IndexSignature &&
        (modifier.kind !== SyntaxKind.StaticKeyword ||
          !ts.isClassLike(node.parent))
      ) {
        throwErrorOnTsNode(
          modifier,
          `'${ts.tokenToString(
            modifier.kind
          )}' modifier cannot appear on an index signature`
        );
      }
    }

    if (
      modifier.kind !== SyntaxKind.InKeyword &&
      modifier.kind !== SyntaxKind.OutKeyword &&
      node.kind === SyntaxKind.TypeParameter
    ) {
      throwErrorOnTsNode(
        modifier,
        `'${ts.tokenToString(
          modifier.kind
        )}' modifier cannot appear on a type parameter`
      );
    }

    if (
      modifier.kind === SyntaxKind.ReadonlyKeyword &&
      node.kind !== SyntaxKind.PropertyDeclaration &&
      node.kind !== SyntaxKind.PropertySignature &&
      node.kind !== SyntaxKind.IndexSignature &&
      node.kind !== SyntaxKind.Parameter
    ) {
      throwErrorOnTsNode(
        modifier,
        "'readonly' modifier can only appear on a property declaration or index signature."
      );
    }

    if (
      modifier.kind === SyntaxKind.DeclareKeyword &&
      ts.isClassLike(node.parent) &&
      !ts.isPropertyDeclaration(node)
    ) {
      throwErrorOnTsNode(
        modifier,
        `'${ts.tokenToString(
          modifier.kind
        )}' modifier cannot appear on class elements of this kind.`
      );
    }

    if (
      modifier.kind === SyntaxKind.AbstractKeyword &&
      node.kind !== SyntaxKind.ClassDeclaration &&
      node.kind !== SyntaxKind.ConstructorType &&
      node.kind !== SyntaxKind.MethodDeclaration &&
      node.kind !== SyntaxKind.PropertyDeclaration &&
      node.kind !== SyntaxKind.GetAccessor &&
      node.kind !== SyntaxKind.SetAccessor
    ) {
      throwErrorOnTsNode(
        modifier,
        `'${ts.tokenToString(
          modifier.kind
        )}' modifier can only appear on a class, method, or property declaration.`
      );
    }

    if (
      (modifier.kind === SyntaxKind.StaticKeyword ||
        modifier.kind === SyntaxKind.PublicKeyword ||
        modifier.kind === SyntaxKind.ProtectedKeyword ||
        modifier.kind === SyntaxKind.PrivateKeyword) &&
      (node.parent.kind === SyntaxKind.ModuleBlock ||
        node.parent.kind === SyntaxKind.SourceFile)
    ) {
      throwErrorOnTsNode(
        modifier,
        `'${ts.tokenToString(
          modifier.kind
        )}' modifier cannot appear on a module or namespace element.`
      );
    }

    if (
      modifier.kind === SyntaxKind.AccessorKeyword &&
      node.kind !== SyntaxKind.PropertyDeclaration
    ) {
      throwErrorOnTsNode(
        modifier,
        "'accessor' modifier can only appear on a property declaration."
      );
    }

    // `checkGrammarAsyncModifier` function in `typescript`
    if (
      modifier.kind === SyntaxKind.AsyncKeyword &&
      node.kind !== SyntaxKind.MethodDeclaration &&
      node.kind !== SyntaxKind.FunctionDeclaration &&
      node.kind !== SyntaxKind.FunctionExpression &&
      node.kind !== SyntaxKind.ArrowFunction
    ) {
      throwErrorOnTsNode(modifier, "'async' modifier cannot be used here.");
    }
  }
}

function getTsNode(node, tsParseResult) {
  const { esTreeNodeToTSNodeMap, tsNodeToESTreeNodeMap } = tsParseResult;
  const tsNode = esTreeNodeToTSNodeMap.get(node);
  if (!tsNode) {
    return;
  }

  const esTreeNode = tsNodeToESTreeNodeMap.get(tsNode);
  if (esTreeNode !== node) {
    return;
  }

  return tsNode;
}

// `isModifierKind` in `typescript`
const POSSIBLE_MODIFIERS = [
  "abstract",
  "accessor",
  "async",
  "const",
  "declare",
  "default",
  "export",
  "in",
  "out",
  "override",
  "private",
  "protected",
  "public",
  "readonly",
  "static",
];

const decoratorOrModifierRegExp = new RegExp(
  ["@", ...POSSIBLE_MODIFIERS].join("|")
);

async function throwErrorForInvalidNodes(tsParseResult, options) {
  if (!decoratorOrModifierRegExp.test(options.originalText)) {
    return;
  }

  if (!ts) {
    ({ default: ts } = await import("typescript"));
  }

  visitNode(tsParseResult.ast, (esTreeNode) => {
    const tsNode = getTsNode(esTreeNode, tsParseResult);
    if (!tsNode) {
      return;
    }

    throwErrorForInvalidDecorator(tsNode);
    throwErrorForInvalidAbstractProperty(tsNode, esTreeNode);
    throwErrorForInvalidModifier(tsNode);
  });
}

export {
  throwErrorForInvalidNodes,
  // For test
  POSSIBLE_MODIFIERS,
};
