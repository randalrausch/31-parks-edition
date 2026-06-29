// All resources for the Azure backend, deployed into the resource group.
//
// Security: GAME DATA in Table Storage is accessed by the Function App's
// system-assigned managed identity (Storage Table Data Contributor) — NO secret.
// The Functions runtime store uses a connection string (standard for Consumption;
// holds no game data). CORS is locked to the Static Web App origin.
//
// Cost guards: a max scale-out cap, a Log Analytics daily ingestion cap, durable
// rate-limit ceilings (passed to the app), and an optional monthly Budget alert.
param location string
param resourceToken string
param tags object
param customDomain string
param monthlyBudgetAmount int
param budgetAlertEmail string
param maxFunctionInstances int
param logAnalyticsDailyQuotaGb int
param maxGamesPerDay int
param maxGamesPerIpPerHour int

@description('First of the current month — required start for the monthly budget.')
param budgetStartDate string = utcNow('yyyy-MM-01')

var tableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${resourceToken}'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${resourceToken}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    // Cap telemetry ingestion so a flood can't run up Log Analytics cost.
    workspaceCapping: {
      dailyQuotaGb: logAnalyticsDailyQuotaGb
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${resourceToken}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: 'swa-${resourceToken}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  sku: { name: 'Free', tier: 'Free' }
  properties: {
    buildProperties: {
      appLocation: '/'
      outputLocation: 'dist'
    }
  }
}

// Optional custom domain (subdomain via CNAME delegation). The DNS CNAME to the
// SWA default hostname must already exist or provisioning will wait/fail.
resource swaCustomDomain 'Microsoft.Web/staticSites/customDomains@2023-12-01' = if (!empty(customDomain)) {
  parent: swa
  name: customDomain
  properties: {
    validationMethod: 'cname-delegation'
  }
}

var swaOrigin = 'https://${swa.properties.defaultHostname}'
var storageConn = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-${resourceToken}'
  location: location
  tags: tags
  sku: { name: 'Y1', tier: 'Dynamic' }
  kind: 'functionapp'
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: 'func-${resourceToken}'
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|20'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      // Cap peak concurrency so a flood can't fan out to hundreds of instances.
      functionAppScaleLimit: maxFunctionInstances
      cors: {
        allowedOrigins: [ swaOrigin ]
      }
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'AzureWebJobsStorage', value: storageConn }
        { name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING', value: storageConn }
        { name: 'WEBSITE_CONTENTSHARE', value: 'func-${resourceToken}' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'STORAGE_ACCOUNT', value: storage.name }
        { name: 'ALLOWED_ORIGIN', value: swaOrigin }
        // Durable abuse/cost caps (enforced by the app's rate limiter).
        { name: 'MAX_GAMES_PER_DAY', value: string(maxGamesPerDay) }
        { name: 'MAX_GAMES_PER_IP_PER_HOUR', value: string(maxGamesPerIpPerHour) }
      ]
    }
  }
}

resource tableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionApp.id, tableDataContributorRoleId)
  scope: storage
  properties: {
    principalId: functionApp.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', tableDataContributorRoleId)
    principalType: 'ServicePrincipal'
  }
}

// Monthly cost budget with alerts (created only when an amount + email are set).
resource budget 'Microsoft.Consumption/budgets@2023-11-01' = if (monthlyBudgetAmount > 0 && !empty(budgetAlertEmail)) {
  name: 'budget-${resourceToken}'
  properties: {
    category: 'Cost'
    amount: monthlyBudgetAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      actual_80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: [ budgetAlertEmail ]
      }
      forecast_100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: [ budgetAlertEmail ]
      }
    }
  }
}

output apiBaseUrl string = 'https://${functionApp.properties.defaultHostName}/api'
output staticWebAppUrl string = swaOrigin
output staticWebAppName string = swa.name
output functionAppName string = functionApp.name
