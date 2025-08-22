// Final NSW Property API with Fixed DAT Parser
// Enhanced for Replit + GitHub Architecture with correct NSW format parsing

const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const cors = require('cors');
const AdmZip = require('adm-zip');
const https = require('https');

class NSWPropertyAPI {
  constructor(config = {}) {
    this.config = {
      // GitHub repository settings
      githubUser: config.githubUser || 'your-username',
      githubRepo: config.githubRepo || 'nsw-property-data',
      githubBranch: config.githubBranch || 'main',
      
      // Local paths
      dataSourcePath: config.dataSourcePath || './nsw-data-source',
      outputPath: config.outputPath || './processed-data',
      
      // Optimization settings
      maxFileSize: config.maxFileSize || 50 * 1024 * 1024, // 50MB chunks
      recordsPerChunk: config.recordsPerChunk || 5000,
      compressionLevel: config.compressionLevel || 9,
      
      // Replit settings
      port: process.env.PORT || 3000,
      isReplit: process.env.REPL_ID !== undefined
    };

    this.app = express();
    this.cache = new Map(); // Local cache for Replit
    this.stats = {
      totalProperties: 0,
      totalFiles: 0,
      yearsProcessed: new Set(),
      lastProcessed: null,
      githubFiles: 0,
      dataSize: 0
    };

    this.setupServer();
  }

  setupServer() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.static('public'));
    
    // Health check with GitHub data status
    this.app.get('/api/health', async (req, res) => {
      const githubStatus = await this.checkGitHubDataAvailability();
      res.json({
        status: 'healthy',
        environment: this.config.isReplit ? 'replit' : 'local',
        githubData: githubStatus,
        cache: {
          size: this.cache.size,
          keys: Array.from(this.cache.keys()).slice(0, 10)
        },
        stats: {
          ...this.stats,
          yearsProcessed: Array.from(this.stats.yearsProcessed)
        }
      });
    });

    // Search by address - loads from GitHub on demand
    this.app.get('/api/search/address', async (req, res) => {
      try {
        const { q: query, limit = 50 } = req.query;
        
        if (!query || query.length < 3) {
          return res.status(400).json({ 
            error: 'Query must be at least 3 characters long' 
          });
        }

        const results = await this.searchAddressFromGitHub(query, parseInt(limit));
        
        res.json({
          query,
          count: results.length,
          results,
          source: 'github',
          cached: this.cache.has('search_' + query)
        });
      } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get property by address
    this.app.get('/api/property/:address', async (req, res) => {
      try {
        const address = decodeURIComponent(req.params.address);
        const properties = await this.getPropertyFromGitHub(address);
        
        if (properties && properties.length > 0) {
          res.json({
            address,
            count: properties.length,
            properties,
            source: 'github'
          });
        } else {
          res.status(404).json({ error: 'Property not found' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Search by price range
    this.app.get('/api/search/price', async (req, res) => {
      try {
        const { min = 0, max = 999999999, suburb, year, limit = 50 } = req.query;
        
        const results = await this.searchPriceFromGitHub({
          minPrice: parseInt(min),
          maxPrice: parseInt(max),
          suburb,
          year: year ? parseInt(year) : null,
          limit: parseInt(limit)
        });

        res.json({
          filters: { min, max, suburb, year },
          count: results.length,
          results,
          source: 'github'
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get available years and stats
    this.app.get('/api/years', async (req, res) => {
      try {
        const years = await this.getAvailableYearsFromGitHub();
        res.json({
          years,
          count: years.length,
          source: 'github'
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Clear cache endpoint
    this.app.post('/api/cache/clear', (req, res) => {
      this.cache.clear();
      res.json({ message: 'Cache cleared successfully' });
    });

    // Serve main webapp
    this.app.get('/', (req, res) => {
      res.send(this.generateMainPage());
    });
  }

  // GitHub Data Access Methods
  async searchAddressFromGitHub(query, limit) {
    const cacheKey = 'search_' + query.toLowerCase();
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      console.log('Cache hit for: ' + query);
      return this.cache.get(cacheKey).slice(0, limit);
    }

    try {
      // Get master index from GitHub
      const masterIndex = await this.fetchGitHubFile('master-address-index.json');
      if (!masterIndex) {
        throw new Error('Master index not found on GitHub');
      }

      const searchTerm = query.toLowerCase();
      const matchingAddresses = Object.keys(masterIndex)
        .filter(addr => addr.includes(searchTerm))
        .slice(0, 20); // Limit addresses to search

      const results = [];
      
      // Load data for matching addresses
      for (const address of matchingAddresses) {
        const years = Object.keys(masterIndex[address]);
        
        for (const year of years.slice(0, 3)) { // Limit years per address
          try {
            const properties = await this.loadPropertiesForAddressYear(address, year);
            results.push(...properties);
            
            if (results.length >= limit * 2) break; // Get extra for filtering
          } catch (error) {
            continue;
          }
        }
        
        if (results.length >= limit * 2) break;
      }

      // Sort by date and limit
      const sortedResults = results
        .sort((a, b) => new Date(b.saleDate) - new Date(a.saleDate))
        .slice(0, limit);

      // Cache results for 5 minutes
      this.cache.set(cacheKey, sortedResults);
      setTimeout(() => this.cache.delete(cacheKey), 5 * 60 * 1000);

      return sortedResults;
    } catch (error) {
      console.error('GitHub search error:', error);
      return [];
    }
  }

  async getPropertyFromGitHub(address) {
    const cacheKey = 'property_' + address.toLowerCase();
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const masterIndex = await this.fetchGitHubFile('master-address-index.json');
      const normalizedAddress = address.toLowerCase();
      
      if (!masterIndex[normalizedAddress]) {
        return [];
      }

      const results = [];
      const years = Object.keys(masterIndex[normalizedAddress]);
      
      for (const year of years) {
        const properties = await this.loadPropertiesForAddressYear(normalizedAddress, year);
        results.push(...properties);
      }

      // Cache for 10 minutes
      this.cache.set(cacheKey, results);
      setTimeout(() => this.cache.delete(cacheKey), 10 * 60 * 1000);

      return results;
    } catch (error) {
      console.error('Property fetch error:', error);
      return [];
    }
  }

  async searchPriceFromGitHub({ minPrice, maxPrice, suburb, year, limit }) {
    const cacheKey = 'price_' + minPrice + '_' + maxPrice + '_' + (suburb || 'all') + '_' + (year || 'all');
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey).slice(0, limit);
    }

    try {
      const years = year ? [year.toString()] : await this.getAvailableYearsFromGitHub();
      const results = [];

      for (const searchYear of years.slice(0, 3)) { // Limit years
        const yearResults = await this.searchYearByPrice(searchYear, {
          minPrice, maxPrice, suburb, limit: limit * 2
        });
        results.push(...yearResults);
        
        if (results.length >= limit * 2) break;
      }

      const sortedResults = results
        .sort((a, b) => b.salePrice - a.salePrice)
        .slice(0, limit);

      // Cache for 5 minutes
      this.cache.set(cacheKey, sortedResults);
      setTimeout(() => this.cache.delete(cacheKey), 5 * 60 * 1000);

      return sortedResults;
    } catch (error) {
      console.error('Price search error:', error);
      return [];
    }
  }

  async searchYearByPrice(year, { minPrice, maxPrice, suburb, limit }) {
    try {
      // Get chunk manifest for year
      const manifest = await this.fetchGitHubFile(year + '/manifest.json');
      if (!manifest) return [];

      const results = [];
      
      // Search through chunks (limit to first few for performance)
      for (const chunk of manifest.chunks.slice(0, 5)) {
        const chunkData = await this.fetchGitHubFile(year + '/' + chunk.filename);
        if (!chunkData) continue;

        const matches = chunkData.properties.filter(p => {
          // Handle both compressed and full format
          const price = p.$ || p.salePrice || 0;
          const propSuburb = p.s || p.suburb || '';
          
          let match = price >= minPrice && price <= maxPrice;
          
          if (suburb) {
            match = match && propSuburb.toLowerCase().includes(suburb.toLowerCase());
          }
          
          return match;
        });

        results.push(...matches.map(p => this.decompressProperty(p)));
        
        if (results.length >= limit) break;
      }

      return results;
    } catch (error) {
      return [];
    }
  }

  async loadPropertiesForAddressYear(address, year) {
    try {
      // Try to get from specific address file first
      const addressFile = year + '/addresses/' + this.hashAddress(address) + '.json';
      const addressData = await this.fetchGitHubFile(addressFile);
      
      if (addressData) {
        return addressData.properties
          .filter(p => (p.a || p.address || '').toLowerCase() === address.toLowerCase())
          .map(p => this.decompressProperty(p));
      }

      // Fallback: search through chunks
      const manifest = await this.fetchGitHubFile(year + '/manifest.json');
      if (!manifest) return [];

      for (const chunk of manifest.chunks.slice(0, 3)) {
        const chunkData = await this.fetchGitHubFile(year + '/' + chunk.filename);
        if (!chunkData) continue;

        const matches = chunkData.properties.filter(p => 
          (p.a || p.address || '').toLowerCase() === address.toLowerCase()
        );
        
        if (matches.length > 0) {
          return matches.map(p => this.decompressProperty(p));
        }
      }

      return [];
    } catch (error) {
      return [];
    }
  }

  async fetchGitHubFile(filepath) {
    const cacheKey = 'github_' + filepath;
    
    // Check memory cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const url = 'https://raw.githubusercontent.com/' + this.config.githubUser + '/' + this.config.githubRepo + '/' + this.config.githubBranch + '/' + filepath;
    
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          resolve(null);
          return;
        }

        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            
            // Cache for 15 minutes
            this.cache.set(cacheKey, parsed);
            setTimeout(() => this.cache.delete(cacheKey), 15 * 60 * 1000);
            
            resolve(parsed);
          } catch (error) {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    });
  }

  async getAvailableYearsFromGitHub() {
    try {
      const masterIndex = await this.fetchGitHubFile('master-address-index.json');
      if (!masterIndex) return [];

      const years = new Set();
      Object.values(masterIndex).forEach(addressData => {
        Object.keys(addressData).forEach(year => years.add(parseInt(year)));
      });

      return Array.from(years).sort((a, b) => b - a);
    } catch (error) {
      return [];
    }
  }

  async checkGitHubDataAvailability() {
    try {
      const masterIndex = await this.fetchGitHubFile('master-address-index.json');
      return {
        available: !!masterIndex,
        addresses: masterIndex ? Object.keys(masterIndex).length : 0,
        lastCheck: new Date().toISOString()
      };
    } catch (error) {
      return {
        available: false,
        error: error.message,
        lastCheck: new Date().toISOString()
      };
    }
  }

  // Data Processing Methods (for local use)
  async processDataForGitHub() {
    console.log('🚀 Processing NSW Property Data for GitHub Storage...');
    
    await this.ensureDirectoryExists(this.config.outputPath);
    
    try {
      const files = await fs.readdir(this.config.dataSourcePath);
      const zipFiles = files.filter(f => f.toLowerCase().endsWith('.zip'));
      
      console.log('📦 Found ' + zipFiles.length + ' zip files to process');
      
      for (const zipFile of zipFiles) {
        await this.processYearlyZipOptimized(zipFile);
      }
      
      // Create optimized indices
      await this.createOptimizedIndices();
      
      // Generate GitHub-ready structure
      await this.finalizeGitHubStructure();
      
      console.log('✅ Processing completed! Ready for GitHub upload.');
      console.log('📊 Total files: ' + this.stats.githubFiles);
      console.log('💾 Total size: ' + (this.stats.dataSize / 1024 / 1024).toFixed(2) + 'MB');
      
    } catch (error) {
      console.error('❌ Processing error:', error);
      throw error;
    }
  }

  async processYearlyZipOptimized(zipFileName) {
    const year = this.extractYear(zipFileName);
    console.log('📅 Processing ' + zipFileName + ' (' + year + ')...');

    try {
      const zipPath = path.join(this.config.dataSourcePath, zipFileName);
      const zip = new AdmZip(zipPath);
      
      const datFiles = this.findDATFilesRecursively(zip);
      console.log('   📄 Found ' + datFiles.length + ' DAT files');

      const allProperties = [];
      
      // Parse all DAT files with progress tracking
      for (let i = 0; i < datFiles.length; i++) {
        const datFile = datFiles[i];
        try {
          const content = datFile.getData().toString('utf8');
          const properties = this.parseDATContentOptimized(content, year);
          allProperties.push(...properties);
          
          // Log progress every 1000 files
          if ((i + 1) % 1000 === 0) {
            console.log('     Progress: ' + (i+1) + '/' + datFiles.length + ' files processed, ' + allProperties.length + ' properties found');
          }
        } catch (error) {
          console.error('     ❌ Error parsing ' + datFile.entryName + ':', error.message);
        }
      }

      // Create optimized chunks for GitHub
      await this.createOptimizedChunks(year, allProperties);
      
      this.stats.totalProperties += allProperties.length;
      this.stats.yearsProcessed.add(year);
      
      console.log('   ✅ Processed ' + year + ' - ' + allProperties.length + ' properties');

    } catch (error) {
      console.error('   ❌ Failed to process ' + zipFileName + ': ' + error.message);
    }
  }

  // Enhanced DAT file finder - handles nested ZIP structures
  findDATFilesRecursively(zip) {
    const datFiles = [];
    const entries = zip.getEntries();
    
    console.log('     🔍 Scanning ZIP entries: ' + entries.length + ' total entries');
    
    // Show structure for debugging
    const structure = {};
    entries.forEach(entry => {
      const ext = entry.entryName.split('.').pop().toLowerCase();
      if (!structure[ext]) structure[ext] = 0;
      structure[ext]++;
    });
    console.log('     📊 File types found:', JSON.stringify(structure));
    
    entries.forEach(entry => {
      const entryName = entry.entryName.toLowerCase();
      
      // Check for DAT files
      if (!entry.isDirectory && entryName.endsWith('.dat')) {
        datFiles.push(entry);
      }
      
      // Also check for nested ZIP files
      if (!entry.isDirectory && entryName.endsWith('.zip')) {
        console.log('       🔄 Found nested ZIP: ' + entry.entryName);
        try {
          const nestedZipData = entry.getData();
          const nestedZip = new AdmZip(nestedZipData);
          const nestedDatFiles = this.findDATFilesRecursively(nestedZip);
          datFiles.push(...nestedDatFiles);
          console.log('       ✅ Extracted ' + nestedDatFiles.length + ' DAT files from nested ZIP');
        } catch (error) {
          console.log('       ❌ Failed to read nested ZIP: ' + error.message);
        }
      }
    });
    
    return datFiles;
  }

  // Fixed DAT content parser based on official NSW format
  parseDATContentOptimized(content, year) {
    const lines = content.split('\n').filter(line => line.trim());
    const properties = [];
    
    if (lines.length === 0) return properties;
    
    let validRecords = 0;
    let bRecords = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        // Only process B records (property sales)
        if (line.startsWith('B;')) {
          bRecords++;
          const property = this.parsePropertyLine(line, year);
          
          if (property && property.address && property.salePrice > 0) {
            properties.push(property);
            validRecords++;
          }
        }
        
      } catch (error) {
        continue;
      }
    }

    // Only log for first few files to avoid spam
    if (Math.random() < 0.01) { // 1% of files
      console.log('       📊 Results: ' + bRecords + ' B-records found, ' + validRecords + ' valid properties extracted');
    }

    return properties;
  }

  parsePropertyLine(line, year) {
    // Split by semicolon - official NSW format
    const fields = line.split(';');
    
    if (fields.length < 20) {
      return null;
    }

    try {
      // Based on official NSW format and actual data:
      // B;001;1667;1;20200106 01:00;;;103;RAWSON ST;ABERDARE;2325;1011.83;M;20191116;20191230;260000;R2;R;RESIDENCE;;AAD;;0;AP807655;
      //   0  1   2   3      4        5 6 7      8          9      10    11     12 13       14       15     16 17    18     19 20 21 22     23
      
      const property = {
        recordType: fields[0],           // 'B'
        districtCode: fields[1],         // '001' 
        propertyId: fields[2],           // '1667'
        saleCounter: fields[3],          // '1'
        downloadDateTime: fields[4],     // '20200106 01:00'
        propertyName: fields[5] || '',   // Property name (often empty)
        unitNumber: fields[6] || '',     // Unit number (often empty) 
        houseNumber: fields[7] || '',    // House number ('103')
        streetName: fields[8] || '',     // Street name ('RAWSON ST')
        locality: fields[9] || '',       // Locality/Suburb ('ABERDARE')
        postcode: fields[10] || '',      // Postcode ('2325')
        area: parseFloat(fields[11]) || 0, // Area (1011.83)
        areaType: fields[12] || '',      // Area type ('M' = square metres)
        contractDate: fields[13] || '',  // Contract date ('20191116')
        settlementDate: fields[14] || '', // Settlement date ('20191230') 
        salePrice: parseFloat(fields[15]) || 0, // Purchase price (260000)
        zoning: fields[16] || '',        // Zoning ('R2')
        natureOfProperty: fields[17] || '', // Nature ('R' = Residence)
        primaryPurpose: fields[18] || '', // Primary purpose ('RESIDENCE')
        strataLot: fields[19] || '',     // Strata lot
        year: parseInt(year)
      };

      // Build full address from components
      let fullAddress = '';
      if (property.unitNumber) fullAddress += property.unitNumber + '/';
      if (property.houseNumber) fullAddress += property.houseNumber + ' ';
      if (property.streetName) fullAddress += property.streetName;
      
      property.address = fullAddress.trim().toUpperCase();
      property.suburb = property.locality.toUpperCase();
      property.propertyType = this.determinePropertyType(property.natureOfProperty, property.primaryPurpose);
      property.saleDate = this.formatDate(property.settlementDate);

      // Validate essential fields
      if (property.address && 
          property.suburb && 
          property.salePrice > 1000 && 
          property.salePrice < 50000000) {
        return property;
      }

      return null;
      
    } catch (error) {
      return null;
    }
  }

  determinePropertyType(nature, purpose) {
    if (nature === 'V') return 'Vacant Land';
    if (nature === 'R') return 'Residence';
    if (purpose && purpose.includes('RESIDENCE')) return 'House';
    if (purpose && purpose.includes('UNIT')) return 'Unit';
    if (purpose && purpose.includes('TOWNHOUSE')) return 'Townhouse';
    if (nature === '3' && purpose) return purpose; // Other with description
    return 'Property';
  }

  formatDate(dateStr) {
    if (!dateStr || dateStr.length !== 8) return null;
    
    try {
      // Convert YYYYMMDD to YYYY-MM-DD
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      return year + '-' + month + '-' + day;
    } catch (error) {
      return null;
    }
  }

  async createOptimizedChunks(year, properties) {
    const yearDir = path.join(this.config.outputPath, year.toString());
    await this.ensureDirectoryExists(yearDir);
    await this.ensureDirectoryExists(path.join(yearDir, 'addresses'));

    // Sort properties by address for better grouping
    properties.sort((a, b) => a.address.localeCompare(b.address));

    // Create main chunks
    const chunks = [];
    const chunkSize = this.config.recordsPerChunk;
    
    for (let i = 0; i < properties.length; i += chunkSize) {
      const chunkProperties = properties.slice(i, i + chunkSize);
      const chunkId = String(Math.floor(i / chunkSize)).padStart(3, '0');
      const filename = 'properties-' + year + '-' + chunkId + '.json';
      
      const chunkData = {
        year: parseInt(year),
        chunkId,
        count: chunkProperties.length,
        properties: chunkProperties.map(p => this.compressProperty(p))
      };

      const filepath = path.join(yearDir, filename);
      await fs.writeFile(filepath, JSON.stringify(chunkData));
      
      const stats = await fs.stat(filepath);
      chunks.push({
        filename,
        count: chunkProperties.length,
        size: stats.size
      });
      
      this.stats.githubFiles++;
      this.stats.dataSize += stats.size;
    }

    // Create manifest
    const manifest = {
      year: parseInt(year),
      totalProperties: properties.length,
      chunks,
      created: new Date().toISOString()
    };

    await fs.writeFile(
      path.join(yearDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    // Create address-specific files for popular addresses
    await this.createAddressFiles(year, properties);
  }

  async createAddressFiles(year, properties) {
    const addressGroups = {};
    
    // Group by address
    properties.forEach(prop => {
      const addr = prop.address.toLowerCase();
      if (!addressGroups[addr]) {
        addressGroups[addr] = [];
      }
      addressGroups[addr].push(prop);
    });

    // Create files for addresses with multiple sales
    const addressDir = path.join(this.config.outputPath, year.toString(), 'addresses');
    
    for (const [address, addressProps] of Object.entries(addressGroups)) {
      if (addressProps.length > 1) { // Only for multiple sales
        const filename = this.hashAddress(address) + '.json';
        const filepath = path.join(addressDir, filename);
        
        await fs.writeFile(filepath, JSON.stringify({
          address: addressProps[0].address, // Original case
          count: addressProps.length,
          properties: addressProps.map(p => this.compressProperty(p))
        }));
      }
    }
  }

  // Utility methods
  compressProperty(prop) {
    return {
      a: prop.address,
      s: prop.suburb,
      p: prop.postcode,
      t: prop.propertyType,
      $: prop.salePrice,
      d: prop.saleDate,
      l: prop.districtCode,
      m: prop.area,
      y: prop.year,
      z: prop.zoning,
      n: prop.natureOfProperty
    };
  }

  decompressProperty(comp) {
    return {
      address: comp.a || comp.address || '',
      suburb: comp.s || comp.suburb || '',
      postcode: comp.p || comp.postcode || '',
      propertyType: comp.t || comp.propertyType || '',
      salePrice: comp.$ || comp.salePrice || 0,
      saleDate: comp.d || comp.saleDate || '',
      districtCode: comp.l || comp.districtCode || '',
      area: comp.m || comp.area || 0,
      year: comp.y || comp.year || 0,
      zoning: comp.z || comp.zoning || '',
      natureOfProperty: comp.n || comp.natureOfProperty || ''
    };
  }

  hashAddress(address) {
    return Buffer.from(address).toString('base64')
      .replace(/[/+=]/g, '')
      .slice(0, 12);
  }

  extractYear(fileName) {
    const match = fileName.match(/(\d{4})/);
    return match ? parseInt(match[1]) : new Date().getFullYear();
  }

  cleanAddress(address) {
    return address.trim().replace(/\s+/g, ' ').toUpperCase();
  }

  cleanText(text) {
    return text.trim().replace(/\s+/g, ' ');
  }

  parseArea(areaStr) {
    const cleaned = areaStr.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  }

  async createOptimizedIndices() {
    console.log('🔍 Creating optimized indices...');
    
    const masterIndex = {};
    const years = Array.from(this.stats.yearsProcessed);
    
    for (const year of years) {
      try {
        const manifest = JSON.parse(
          await fs.readFile(
            path.join(this.config.outputPath, year.toString(), 'manifest.json'),
            'utf8'
          )
        );

        // Build address index for this year
        for (const chunk of manifest.chunks) {
          const chunkPath = path.join(
            this.config.outputPath, 
            year.toString(), 
            chunk.filename
          );
          
          const chunkData = JSON.parse(await fs.readFile(chunkPath, 'utf8'));
          
          chunkData.properties.forEach(prop => {
            const addr = (prop.a || prop.address || '').toLowerCase();
            if (!addr) return;
            
            if (!masterIndex[addr]) {
              masterIndex[addr] = {};
            }
            
            if (!masterIndex[addr][year]) {
              masterIndex[addr][year] = 0;
            }
            
            masterIndex[addr][year]++;
          });
        }
      } catch (error) {
        console.error('Error indexing ' + year + ':', error.message);
      }
    }

    // Save master index
    await fs.writeFile(
      path.join(this.config.outputPath, 'master-address-index.json'),
      JSON.stringify(masterIndex)
    );

    console.log('   ✅ Created master index with ' + Object.keys(masterIndex).length + ' addresses');
  }

  async finalizeGitHubStructure() {
    // Create README for GitHub repo
    const readme = '# NSW Property Sales Data\n\nOptimized property sales data for NSW, processed for GitHub storage.\n\n## Structure\n\n- `master-address-index.json` - Main address index\n- `YYYY/` - Data by year\n  - `manifest.json` - Year metadata\n  - `properties-YYYY-XXX.json` - Property chunks\n  - `addresses/` - Individual address files\n\n## Usage\n\nThis data is designed to be accessed via API. See the main webapp for search interface.\n\nGenerated: ' + new Date().toISOString() + '\nProperties: ' + this.stats.totalProperties.toLocaleString() + '\nYears: ' + Array.from(this.stats.yearsProcessed).join(', ');

    await fs.writeFile(path.join(this.config.outputPath, 'README.md'), readme);
  }

  generateMainPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NSW Property Search</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f7fa; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2rem; border-radius: 15px; text-align: center; margin-bottom: 2rem; }
        .search-box { background: white; padding: 2rem; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); margin-bottom: 2rem; }
        .search-input { width: 100%; padding: 1rem; border: 2px solid #e1e8ed; border-radius: 10px; font-size: 1.1rem; margin-bottom: 1rem; }
        .search-input:focus { border-color: #667eea; outline: none; }
        .search-btn { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1rem 2rem; border: none; border-radius: 10px; font-size: 1.1rem; cursor: pointer; width: 100%; }
        .search-btn:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(102,126,234,0.3); }
        .results { margin-top: 2rem; }
        .property { background: white; border-radius: 10px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: 0 5px 15px rgba(0,0,0,0.08); }
        .property-address { font-size: 1.2rem; font-weight: bold; color: #2c3e50; margin-bottom: 0.5rem; }
        .property-details { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem; }
        .detail-item { color: #7f8c8d; }
        .detail-value { font-weight: bold; color: #2c3e50; }
        .price { color: #27ae60; font-size: 1.3rem; font-weight: bold; }
        .loading { text-align: center; padding: 3rem; color: #7f8c8d; }
        .status { background: #e8f4fd; border: 1px solid #bee5eb; padding: 1rem; border-radius: 10px; margin-bottom: 1rem; }
        @media (max-width: 768px) {
            .container { padding: 10px; }
            .header, .search-box { padding: 1rem; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏠 NSW Property Search</h1>
            <p>Search historical property sales across NSW</p>
        </div>
        
        <div id="status" class="status">
            <strong>Status:</strong> <span id="statusText">Checking data availability...</span>
        </div>
        
        <div class="search-box">
            <input type="text" id="searchInput" class="search-input" placeholder="Enter property address (e.g., '103 Rawson Street, Aberdare')">
            <button onclick="searchProperties()" class="search-btn">🔍 Search Properties</button>
        </div>
        
        <div id="results" class="results"></div>
    </div>

    <script>
        // Check API status on load
        window.addEventListener('load', checkStatus);
        
        async function checkStatus() {
            try {
                const response = await fetch('/api/health');
                const data = await response.json();
                
                const statusText = document.getElementById('statusText');
                if (data.githubData?.available) {
                    statusText.innerHTML = '✅ Ready - ' + data.githubData.addresses.toLocaleString() + ' addresses available';
                } else {
                    statusText.innerHTML = '⚠️ GitHub data not available - please check configuration';
                }
            } catch (error) {
                document.getElementById('statusText').innerHTML = '❌ API not responding';
            }
        }
        
        async function searchProperties() {
            const query = document.getElementById('searchInput').value.trim();
            const results = document.getElementById('results');
            
            if (query.length < 3) {
                results.innerHTML = '<div class="property"><p style="color: #e74c3c;">Please enter at least 3 characters</p></div>';
                return;
            }
            
            results.innerHTML = '<div class="loading">🔍 Searching GitHub database...</div>';
            
            try {
                const response = await fetch('/api/search/address?q=' + encodeURIComponent(query) + '&limit=20');
                const data = await response.json();
                
                if (data.results && data.results.length > 0) {
                    results.innerHTML = '<h3 style="margin-bottom: 1rem; color: #2c3e50;">Found ' + data.count + ' results for "' + query + '"</h3>' +
                        data.results.map(property => {
                            return '<div class="property">' +
                                '<div class="property-address">' + property.address + '</div>' +
                                '<div class="property-details">' +
                                    '<div class="detail-item">' +
                                        '<div>Sale Price</div>' +
                                        '<div class="price"> + (property.salePrice ? property.salePrice.toLocaleString() : 'N/A') + '</div>' +
                                    '</div>' +
                                    '<div class="detail-item">' +
                                        '<div>Sale Date</div>' +
                                        '<div class="detail-value">' + (property.saleDate || 'N/A') + '</div>' +
                                    '</div>' +
                                    '<div class="detail-item">' +
                                        '<div>Suburb</div>' +
                                        '<div class="detail-value">' + (property.suburb || 'N/A') + '</div>' +
                                    '</div>' +
                                    '<div class="detail-item">' +
                                        '<div>Property Type</div>' +
                                        '<div class="detail-value">' + (property.propertyType || 'N/A') + '</div>' +
                                    '</div>' +
                                    '<div class="detail-item">' +
                                        '<div>Area</div>' +
                                        '<div class="detail-value">' + (property.area ? property.area + 'm²' : 'N/A') + '</div>' +
                                    '</div>' +
                                    '<div class="detail-item">' +
                                        '<div>Postcode</div>' +
                                        '<div class="detail-value">' + (property.postcode || 'N/A') + '</div>' +
                                    '</div>' +
                                '</div>' +
                            '</div>';
                        }).join('') +
                        '<div style="text-align: center; margin-top: 1rem; color: #7f8c8d;">' +
                            (data.cached ? '⚡ Cached' : '🌐 Live') + ' results from GitHub' +
                        '</div>';
                } else {
                    results.innerHTML = '<div class="property"><p>No properties found. Try a different search term or check the spelling.</p></div>';
                }
            } catch (error) {
                results.innerHTML = '<div class="property"><p style="color: #e74c3c;">Error searching properties. Please try again.</p></div>';
                console.error('Search error:', error);
            }
        }
        
        // Allow Enter key to search
        document.getElementById('searchInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchProperties();
            }
        });
        
        // Auto-search after typing (debounced)
        let searchTimeout;
        document.getElementById('searchInput').addEventListener('input', function(e) {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            
            if (query.length >= 5) {
                searchTimeout = setTimeout(() => {
                    searchProperties();
                }, 1000);
            }
        });
    </script>
</body>
</html>`;
  }

  async ensureDirectoryExists(dirPath) {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  // Debug method to analyze single ZIP
  async debugSingleZip(zipFileName) {
    console.log('🔍 DEBUG: Analyzing ' + zipFileName);
    
    try {
      const zipPath = path.join(this.config.dataSourcePath, zipFileName);
      const zip = new AdmZip(zipPath);
      
      const entries = zip.getEntries();
      console.log('📦 Total entries: ' + entries.length);
      
      // Show first 10 entries
      console.log('📂 First 10 entries:');
      entries.slice(0, 10).forEach(entry => {
        console.log('   ' + entry.entryName + (entry.isDirectory ? ' (DIR)' : ' (FILE)'));
      });
      
      // Find DAT files
      const datFiles = this.findDATFilesRecursively(zip);
      
      if (datFiles.length > 0) {
        console.log('📄 Testing first DAT file: ' + datFiles[0].entryName);
        const content = datFiles[0].getData().toString('utf8');
        const lines = content.split('\n').filter(l => l.trim()).slice(0, 5);
        
        console.log('📝 First 5 lines:');
        lines.forEach((line, i) => {
          console.log('   ' + (i+1) + ': ' + line);
        });
        
        // Test parsing
        const properties = this.parseDATContentOptimized(content, this.extractYear(zipFileName));
        console.log('✅ Extracted ' + properties.length + ' valid properties from this file');
        
        if (properties.length > 0) {
          console.log('📋 Sample property:', JSON.stringify(properties[0], null, 2));
        }
      }
      
    } catch (error) {
      console.error('DEBUG ERROR:', error);
    }
  }

  start() {
    this.app.listen(this.config.port, () => {
      console.log('🚀 NSW Property API running on port ' + this.config.port);
      if (this.config.isReplit) {
        console.log('🌐 Your Replit app: https://' + process.env.REPL_SLUG + '.' + process.env.REPL_OWNER + '.repl.co');
      } else {
        console.log('🌐 Local: http://localhost:' + this.config.port);
      }
      console.log('📊 Search interface available at the root URL');
    });
  }
}

// Export for use in scripts
module.exports = NSWPropertyAPI;

// Auto-start if run directly
if (require.main === module) {
  const config = {
    githubUser: process.env.GITHUB_USER || 'your-username',
    githubRepo: process.env.GITHUB_REPO || 'nsw-property-data',
    githubBranch: process.env.GITHUB_BRANCH || 'main'
  };
  
  const api = new NSWPropertyAPI(config);
  api.start();
}