const ERROR_CODES = Object.freeze({
  InvalidFrontmatter: 40005,
  TextContentEncodingRequired: 40010,
  ContentTypeSpecificationRequired: 40011,
  InvalidContentType: 40012,
  InvalidContentForContentType: 40015,
  MissingDestinationHeader: 40020,
  PathTraversalNotAllowed: 40021,
  InvalidDestinationHeader: 40022,
  InvalidWithinHeader: 40023,
  MissingTargetTypeHeader: 40053,
  InvalidTargetTypeHeader: 40054,
  MissingTargetHeader: 40055,
  MissingOperation: 40056,
  InvalidOperation: 40057,
  InvalidTargetHeader: 40058,
  InvalidTargetScopeHeader: 40059,
  InvalidFilterQuery: 40070,
  PatchFailed: 40080,
  InvalidPatchInstruction: 40081,
  InvalidPatchVersionHeader: 40082,
  HeaderTargetingRequiresVersion1: 40083,
  PatchHeaderTargetingRequiresExplicitVersion: 40084,
  InvalidSearch: 40090,
  ApiKeyAuthorizationRequired: 40101,
  RequestMethodValidOnlyForFiles: 40510,
  DestinationAlreadyExists: 40920,
  ConflictingTargetSpecification: 42200,
  ErrorPreparingSimpleSearch: 50010,
  FileOperationFailed: 50020,
});

const ERROR_MESSAGES = Object.freeze({
  [ERROR_CODES.InvalidFrontmatter]: 'Document frontmatter could not be parsed.',
  [ERROR_CODES.TextContentEncodingRequired]: 'Incoming content must be text data and have an appropriate text/* Content-type header set (e.g. text/markdown).',
  [ERROR_CODES.ContentTypeSpecificationRequired]: 'Content-Type header required; this API accepts data in multiple content-types and you must indicate the content-type of your request body via the Content-Type header.',
  [ERROR_CODES.InvalidContentType]: 'Unknown or invalid Content-Type specified in Content-Type header.',
  [ERROR_CODES.InvalidContentForContentType]: 'Your request body could not be processed as the content-type specified in your Content-Type header.',
  [ERROR_CODES.MissingDestinationHeader]: 'Destination header is required for MOVE and COPY operations.',
  [ERROR_CODES.PathTraversalNotAllowed]: 'Path traversal is not allowed. Paths must be relative and within the vault.',
  [ERROR_CODES.InvalidDestinationHeader]: 'The Destination header you provided could not be parsed.',
  [ERROR_CODES.InvalidWithinHeader]: 'The Within header must be a single integer, e.g. 0 or -1.',
  [ERROR_CODES.MissingTargetTypeHeader]: "No 'Target-Type' header was provided.",
  [ERROR_CODES.InvalidTargetTypeHeader]: "The target type you specified was invalid. Valid target types are 'heading', 'block', and 'frontmatter'.",
  [ERROR_CODES.MissingTargetHeader]: "No 'Target' header was provided.",
  [ERROR_CODES.MissingOperation]: "No 'Operation' header was provided.",
  [ERROR_CODES.InvalidOperation]: "The 'Operation' header you provided was invalid.",
  [ERROR_CODES.InvalidTargetHeader]: "The 'Target' header you provided was invalid.",
  [ERROR_CODES.InvalidTargetScopeHeader]: 'The target scope you specified was invalid.',
  [ERROR_CODES.InvalidFilterQuery]: 'The query you provided could not be processed.',
  [ERROR_CODES.PatchFailed]: 'The patch you provided could not be applied to the target content.',
  [ERROR_CODES.InvalidPatchInstruction]: 'The patch instruction you provided was malformed or outside the supported algebra.',
  [ERROR_CODES.InvalidPatchVersionHeader]: "The 'Markdown-Patch-Version' header you provided was invalid. Valid values are '1' and '2'.",
  [ERROR_CODES.HeaderTargetingRequiresVersion1]: "Header-based targeting is deprecated and only processed with 'Markdown-Patch-Version: 1'. Use URL path-element targeting for version 2.",
  [ERROR_CODES.PatchHeaderTargetingRequiresExplicitVersion]: "Header-based PATCH targeting requires an explicit Markdown-Patch-Version: use '1' for the deprecated format or '2' for raw-content mode.",
  [ERROR_CODES.InvalidSearch]: 'The search query you provided is not valid.',
  [ERROR_CODES.ApiKeyAuthorizationRequired]: "Authorization required. Find your API key in the Obsidian Ignis REST API server-plugin configuration.",
  [ERROR_CODES.RequestMethodValidOnlyForFiles]: 'Request method is valid only for file paths, not directories.',
  [ERROR_CODES.DestinationAlreadyExists]: 'Destination file already exists.',
  [ERROR_CODES.ConflictingTargetSpecification]: 'Conflicting target specifications: supply the target via URL path elements, via Target-Type/Target headers, or as a patch-instruction body, never more than one.',
  [ERROR_CODES.ErrorPreparingSimpleSearch]: 'Error encountered while preparing simple search.',
  [ERROR_CODES.FileOperationFailed]: 'File operation failed. Check the error message for details.',
});

class ApiError extends Error {
  constructor(message, { statusCode, errorCode, details } = {}) {
    const codeStatus = errorCode ? Math.floor(errorCode / 100) : null;
    super(message || (errorCode ? ERROR_MESSAGES[errorCode] : undefined) || 'Request failed');
    this.name = 'ApiError';
    this.statusCode = statusCode || codeStatus || 500;
    this.errorCode = errorCode || this.statusCode * 100;
    this.details = details;
  }
}

function apiError(errorCode, message, statusCode) {
  const prefix = ERROR_MESSAGES[errorCode];
  const text = message ? (prefix ? `${prefix}\n${message}` : message) : prefix;
  return new ApiError(text, { errorCode, statusCode });
}

function statusError(statusCode, message) {
  return new ApiError(message || require('http').STATUS_CODES[statusCode] || 'Unknown Error', { statusCode });
}

function sendError(res, error) {
  const e = error instanceof ApiError
    ? error
    : new ApiError(error?.message || String(error), { statusCode: error?.statusCode || (error?.code === 'ENOENT' ? 404 : 500) });
  return res.status(e.statusCode).json({ message: e.message, errorCode: e.errorCode });
}

module.exports = { ERROR_CODES, ERROR_MESSAGES, ApiError, apiError, statusError, sendError };
