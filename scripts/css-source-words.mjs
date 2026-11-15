import ts from 'typescript';

/** Keep literal/template words, including conditional and concatenated class
 * values. Comments, variable names and JSX tag names are not CSS usage. */
export function collectCssSourceWords(source, filename, words = new Set()) {
    const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, false);
    const visit = node => {
        if (ts.isStringLiteralLike(node) || node.kind === ts.SyntaxKind.TemplateHead
            || node.kind === ts.SyntaxKind.TemplateMiddle || node.kind === ts.SyntaxKind.TemplateTail) {
            for (const word of node.text.match(/[A-Za-z][\w-]*/g) ?? []) words.add(word);
        }
        // Object-form class helpers can use unquoted property names. Keeping
        // those is conservative, even when the object is not a class map.
        if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
            && ts.isIdentifier(node.name)) words.add(node.name.text);
        ts.forEachChild(node, visit);
    };
    visit(tree);
    return words;
}
