const DATABASE_UNAVAILABLE_NAMES = new Set([
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
]);

function isDatabaseUnavailable(err) {
  return DATABASE_UNAVAILABLE_NAMES.has(err.name)
    || ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ESERVFAIL', 'ETIMEDOUT', 'ETIMEOUT'].includes(err.code)
    || /buffering timed out|topology was destroyed|connection.*timed out/i.test(err.message || '');
}

function safeErrorText(value) {
  return String(value).replace(/mongodb(?:\+srv)?:\/\/[^\s'"]+/gi, '[redacted MongoDB URI]');
}

const errorHandler = (err, req, res, next) => {
  if (isDatabaseUnavailable(err)) {
    console.error(`Database request failed (${err.name || 'Error'}): ${safeErrorText(err.message || 'connection unavailable')}`);
    return res.status(503).json({
      success: false,
      message: 'Database unavailable. Check the MongoDB connection and retry.',
    });
  }

  console.error(safeErrorText(err.stack || err.message || err));

  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      message: `${field} already exists`,
    });
  }

  const status = err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
  });
};

module.exports = errorHandler;
