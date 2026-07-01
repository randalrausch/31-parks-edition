// All resources for the Azure backend, deployed into the resource group.
//
// Security: GAME DATA in Table Storage is accessed by the Function App's
// system-assigned managed identity (Storage Table Data Contributor) — NO secret.
// The Functions runtime store uses a connection string (standard for Consumption;
// holds no game data). CORS is locked to the Static Web App origin.
//
// Cost guards: a max scale-out cap, a Log Analytics daily ingestion cap, and
// durable rate-limit ceilings (passed to the app). A monthly Budget alert is
// managed in the Portal, not here — see the note near the outputs.
param location string
param resourceToken string
param tags object
param customDomain string
@description('Extra CORS origins (comma-separated) the API should accept, e.g. an apex domain bound via the Portal. The SWA default host and any customDomain are always included.')
param extraAllowedOrigins string = ''
param maxFunctionInstances int
param logAnalyticsDailyQuotaGb int
param maxGamesPerDay int
param maxGamesPerIpPerHour int

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
// Origins the API accepts (CORS): the SWA default host, a bound customDomain,
// and any extra origins (e.g. an apex domain added via the Portal, which isn't
// a Bicep-managed customDomain). union() dedupes.
var allowedOrigins = union(
  [ swaOrigin ],
  empty(customDomain) ? [] : [ 'https://${customDomain}' ],
  empty(extraAllowedOrigins) ? [] : split(extraAllowedOrigins, ',')
)
var allowedOriginsCsv = join(allowedOrigins, ',')
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
        allowedOrigins: allowedOrigins
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
        { name: 'ALLOWED_ORIGIN', value: allowedOriginsCsv }
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

// NOTE: the monthly cost budget is intentionally NOT managed here. Azure locks a
// budget's start date once its period is active, so any re-`azd provision` fails
// with "Start date of budgets cannot be updated". The hard caps above
// (maxFunctionInstances, the Log Analytics daily quota, and the per-IP/global
// rate limits) are the real cost enforcement; a budget is only an email alarm.
// Set one in the Portal (Cost Management → Budgets) — see docs/AZURE.md.

output apiBaseUrl string = 'https://${functionApp.properties.defaultHostName}/api'
output staticWebAppUrl string = swaOrigin
output staticWebAppName string = swa.name
output functionAppName string = functionApp.name
