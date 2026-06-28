// Subscription-scoped entry point for `azd up`. Creates the resource group and
// deploys the 31: National Parks Edition Azure backend into it: a standalone
// Azure Functions app (Consumption) reached cross-origin from a Static Web App,
// backed by Table Storage via managed identity, with Application Insights.
targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Environment name (azd) — used to name the resource group + derive a unique token.')
param environmentName string

@minLength(1)
@description('Primary location for all resources (e.g. centralus).')
param location string

var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    resourceToken: resourceToken
    tags: tags
  }
}

// Surfaced as azd env vars + used to wire the web build's VITE_API_BASE.
output AZURE_LOCATION string = location
output RESOURCE_GROUP string = rg.name
output API_BASE_URL string = resources.outputs.apiBaseUrl
output VITE_API_BASE string = resources.outputs.apiBaseUrl
output STATIC_WEB_APP_URL string = resources.outputs.staticWebAppUrl
output STATIC_WEB_APP_NAME string = resources.outputs.staticWebAppName
output FUNCTION_APP_NAME string = resources.outputs.functionAppName
