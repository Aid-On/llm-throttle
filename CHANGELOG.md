# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2025-08-03

### Fixed
- CI warnings and errors resolution
- Improved lint settings configuration

### Changed
- Updated environment settings for Pages deployment
- Enhanced configuration management

## [1.0.0] - Initial Release

### Added
- High-precision dual rate limiting for LLM APIs (RPM + TPM)
- Token bucket algorithm implementation
- Support for multiple storage backends (in-memory)
- TypeScript support with full type definitions
- Comprehensive test suite with coverage reporting
- Demo application with React integration
- Integration with @aid-on/fuzztok for token counting
- Async lock utilities for concurrent operations
- Validation utilities for rate limit parameters
- CI/CD pipeline with GitHub Actions
- Automated deployment to GitHub Pages

### Features
- Request Per Minute (RPM) rate limiting
- Token Per Minute (TPM) rate limiting
- Configurable time windows and burst capacity
- Memory-efficient storage implementation
- Error handling and custom error types
- Clock abstraction for testing
- ESM and CommonJS support
- Node.js 16+ compatibility