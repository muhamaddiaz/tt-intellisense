/** User-facing syntax help for every directive understood by the parser. */
export interface DirectiveInfo {
  syntax: string;
  description: string;
}

export const DIRECTIVE_INFO = {
  GET: {
    syntax: "[% GET expression %]",
    description: "Evaluates an expression and writes its value to the output. The GET keyword is optional.",
  },
  SET: {
    syntax: "[% SET variable = expression %]",
    description: "Assigns a value to a new or existing template variable. The SET keyword is optional.",
  },
  CALL: {
    syntax: "[% CALL expression %]",
    description: "Evaluates an expression, function, or method for its side effects without writing its return value.",
  },
  DEFAULT: {
    syntax: "[% DEFAULT variable = expression %]",
    description: "Assigns a value only when the target variable is undefined or false.",
  },
  INSERT: {
    syntax: "[% INSERT template %]",
    description: "Inserts an external file verbatim without processing any Template Toolkit directives in it.",
  },
  INCLUDE: {
    syntax: "[% INCLUDE template [name = value ...] %]",
    description: "Processes a template file or block in a localized variable context and inserts its output.",
  },
  PROCESS: {
    syntax: "[% PROCESS template [name = value ...] %]",
    description: "Processes a template file or block without localizing variables, so assignments remain visible afterward.",
  },
  WRAPPER: {
    syntax: "[% WRAPPER template [name = value ...] %] ... [% END %]",
    description: "Captures the enclosed output and passes it to a wrapper template as the content variable.",
  },
  BLOCK: {
    syntax: "[% BLOCK name %] ... [% END %]",
    description: "Defines a reusable template component for INCLUDE, PROCESS, or WRAPPER without producing immediate output.",
  },
  VIEW: {
    syntax: "[% VIEW name [option = value ...] %] ... [% END %]",
    description: "Defines an experimental named view containing templates and data as a self-contained presentation unit.",
  },
  IF: {
    syntax: "[% IF condition %] ... [% END %]",
    description: "Processes the enclosed block when the condition evaluates true.",
  },
  UNLESS: {
    syntax: "[% UNLESS condition %] ... [% END %]",
    description: "Processes the enclosed block when the condition evaluates false.",
  },
  ELSIF: {
    syntax: "[% ELSIF condition %]",
    description: "Starts an additional conditional branch when earlier IF or ELSIF conditions were false.",
  },
  ELSE: {
    syntax: "[% ELSE %]",
    description: "Starts the fallback branch of an IF or UNLESS block.",
  },
  SWITCH: {
    syntax: "[% SWITCH expression %] ... [% END %]",
    description: "Evaluates an expression for matching against the CASE branches that follow.",
  },
  CASE: {
    syntax: "[% CASE value %]",
    description: "Starts a matching SWITCH branch. An empty CASE or CASE DEFAULT acts as the fallback; cases do not fall through.",
  },
  FOREACH: {
    syntax: "[% FOREACH item IN list %] ... [% END %]",
    description: "Processes the enclosed block once for each item in a list or entry in a hash.",
  },
  FOR: {
    syntax: "[% FOR item IN list %] ... [% END %]",
    description: "Alias for FOREACH; processes the enclosed block once for each item in a list or entry in a hash.",
  },
  WHILE: {
    syntax: "[% WHILE condition %] ... [% END %]",
    description: "Repeatedly processes the enclosed block while the condition evaluates true.",
  },
  FILTER: {
    syntax: "[% FILTER name[(args)] %] ... [% END %]",
    description: "Post-processes the enclosed output with a named filter. Filters can also follow other directives.",
  },
  USE: {
    syntax: "[% USE [alias =] plugin[(args)] %]",
    description: "Loads and initializes a plugin, optionally assigning it to an alias.",
  },
  MACRO: {
    syntax: "[% MACRO name[(params)] directive %]",
    description: "Defines a reusable directive or directive block that is evaluated whenever the macro is called.",
  },
  PERL: {
    syntax: "[% PERL %] ... [% END %]",
    description: "Evaluates a block of Perl code at runtime. This requires the EVAL_PERL option.",
  },
  RAWPERL: {
    syntax: "[% RAWPERL %] ... [% END %]",
    description: "Injects raw Perl directly into the compiled template subroutine. This advanced feature requires EVAL_PERL.",
  },
  TRY: {
    syntax: "[% TRY %] ... [% CATCH [type] %] ... [% END %]",
    description: "Creates an exception-handling scope for errors raised while processing the enclosed block.",
  },
  THROW: {
    syntax: "[% THROW type [info] %]",
    description: "Raises a typed exception that can be handled by an enclosing CATCH block.",
  },
  CATCH: {
    syntax: "[% CATCH [type] %]",
    description: "Handles a matching exception from TRY and exposes it through the error variable; omit the type for a fallback handler.",
  },
  FINAL: {
    syntax: "[% FINAL %]",
    description: "Starts the final branch of a TRY block, which is processed whether or not an exception occurred.",
  },
  NEXT: {
    syntax: "[% NEXT %]",
    description: "Skips the rest of the current FOREACH or WHILE iteration and starts the next one.",
  },
  LAST: {
    syntax: "[% LAST %]",
    description: "Exits the nearest FOREACH or WHILE loop immediately.",
  },
  BREAK: {
    syntax: "[% BREAK %]",
    description: "Alias for LAST; exits the nearest FOREACH or WHILE loop immediately.",
  },
  RETURN: {
    syntax: "[% RETURN %]",
    description: "Stops the current template and resumes the template that invoked it.",
  },
  STOP: {
    syntax: "[% STOP %]",
    description: "Stops all template processing gracefully and returns success to the caller.",
  },
  CLEAR: {
    syntax: "[% CLEAR %]",
    description: "Clears output accumulated in the current enclosing block, commonly while handling an exception.",
  },
  TAGS: {
    syntax: "[% TAGS style-or-markers %]",
    description: "Changes the directive tag style or delimiters for the remainder of the current template. It must appear alone in a tag.",
  },
  META: {
    syntax: "[% META name = literal ... %]",
    description: "Defines parse-time metadata on the template using literal values.",
  },
  DEBUG: {
    syntax: "[% DEBUG on|off|format|msg ... %]",
    description: "Controls or emits Template Toolkit debugging output when directive debugging is enabled.",
  },
  END: {
    syntax: "[% END %]",
    description: "Closes the nearest open block directive.",
  },
} as const satisfies Record<string, DirectiveInfo>;

export type DirectiveKeyword = keyof typeof DIRECTIVE_INFO;

export function directiveInfo(keyword: string): DirectiveInfo | undefined {
  return DIRECTIVE_INFO[keyword as DirectiveKeyword];
}
