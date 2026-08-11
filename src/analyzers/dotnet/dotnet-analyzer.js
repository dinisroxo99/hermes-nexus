/**
 * .NET Project Analyzer
 *
 * Wraps the existing symbol-index.js functionality for .NET projects.
 * Maintains backward compatibility with current implementation.
 */

import {
  searchSymbolExplorer,
  expandSymbolExplorer,
  getFullGraphExplorer
} from '../../lib/symbol-index.js';

export const dotNetAnalyzer = {
  projectType: 'dotnet',
  name: '.NET analyzer',
  fileExtensions: ['.cs', '.csproj', '.sln', '.slnx'],
  capabilities: {
    analyze: true,
    search: true,
    expand: true,
    fullGraph: true,
    metadata: true
  },
  analyze: analyzeDotNetProject,
  search: (project, query) => searchSymbolExplorer(project, query),
  expand: (project, nodeId, direction) => expandSymbolExplorer(project, nodeId, direction || 'both'),
  fullGraph: (project, opts) => getFullGraphExplorer(project, opts || {})
};

/**
 * Analyze a .NET project
 * @param {object} project - Project object
 * @param {object} [options] - Analysis options
 * @returns {object} Analysis result with search/expand helpers
 */
export function analyzeDotNetProject(project, options = {}) {
  // Return an object that exposes search/expand methods for the analyzer-service
  return {
    projectType: 'dotnet',
    metadata: {
      analyzer: dotNetAnalyzer.name,
      capabilities: dotNetAnalyzer.capabilities
    },
    
    /**
     * Search symbols in this .NET project
     * @param {string} query - Search query
     * @returns {object} Search results
     */
    search: (query) => searchSymbolExplorer(project, query),
    
    /**
     * Expand a node to show dependencies
     * @param {string} nodeId - Node ID
     * @param {'both'|'in'|'out'} direction - Direction
     * @returns {object} Expansion results
     */
    expand: (nodeId, direction) => expandSymbolExplorer(project, nodeId, direction || 'both'),
    
    /**
     * Get full graph with limits
     * @param {object} opts - Options (nodeLimit, edgeLimit, layers, features)
     * @returns {object} Full graph
     */
    fullGraph: (opts) => getFullGraphExplorer(project, opts || {})
  };
}