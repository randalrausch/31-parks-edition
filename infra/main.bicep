// Subscription-scoped entry point for `azd up`. Creates the resource group and
// deploys the 31: National Parks Edition Azure backend into it.
//
// CONFIG: edit infra/main.parameters.json to set the resource group name, custom
// domain, and the cost/abuse caps. The subscription + location + environment
// name come from azd (see docs/AZURE.md → Configuration).
targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Environment name (azd) — used to derive a unique resource token.')
param environmentName string

@minLength(1)
@description('Primary location for all resources (e.g. centralus).')
param location string

@description('Resource group name. Empty = rg-31-parks-edition-<environmentName>.')
param resourceGroupName string = ''

@description('Optional custom subdomain for the site (e.g. play.example.com). A DNS CNAME to the Static Web App default hostname must exist BEFORE this validates. Empty = none.')
param customDomain string = ''

@description('Extra CORS origins (comma-separated) the API should accept, e.g. an apex domain bound via the Portal. The SWA default host and any customDomain are always included.')
param extraAllowedOrigins string = ''

@description('Max concurrent Function instances — caps peak burn rate under load.')
@minValue(1)
@maxValue(200)
param maxFunctionInstances int = 5

@description('Daily Log Analytics ingestion cap (GB) — caps telemetry cost. -1 = unlimited.')
param logAnalyticsDailyQuotaGb int = 1

@description('Hard ceiling on games created per day (global abuse/cost guard).')
@minValue(1)
param maxGamesPerDay int = 500

@description('Max games a single IP may create per hour.')
@minValue(1)
param maxGamesPerIpPerHour int = 20

@description('GitHub repository (owner/name) whose main branch may deploy via OIDC (no stored cloud secret in CI). Set with `azd env set GITHUB_REPO owner/name`. Empty = skip.')
param githubRepo string = ''

var rgName = empty(resourceGroupName) ? 'rg-31-parks-edition-${environmentName}' : resourceGroupName
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
// Applied to the resource group and every resource (resources.bicep threads
// `tags` through), so the whole stack is identifiable in the portal. The
// `azd-env-name` tag is required by azd — don't remove it.
var tags = {
  'azd-env-name': environmentName
  project: '31-parks-edition'
  app: '31: National Parks Edition'
  'managed-by': 'azd'
  repo: 'https://github.com/randalrausch/31-parks-edition'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: rgName
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
    customDomain: customDomain
    extraAllowedOrigins: extraAllowedOrigins
    maxFunctionInstances: maxFunctionInstances
    logAnalyticsDailyQuotaGb: logAnalyticsDailyQuotaGb
    maxGamesPerDay: maxGamesPerDay
    maxGamesPerIpPerHour: maxGamesPerIpPerHour
    githubRepo: githubRepo
  }
}

output AZURE_LOCATION string = location
output RESOURCE_GROUP string = rg.name
output API_BASE_URL string = resources.outputs.apiBaseUrl
output VITE_API_BASE string = resources.outputs.apiBaseUrl
output STATIC_WEB_APP_URL string = resources.outputs.staticWebAppUrl
output STATIC_WEB_APP_NAME string = resources.outputs.staticWebAppName
output FUNCTION_APP_NAME string = resources.outputs.functionAppName
// The three values the OIDC deploy needs as GitHub repo secrets — read them
// after provisioning with `azd env get-values` (see docs/AZURE.md → OIDC).
output AZURE_CLIENT_ID string = resources.outputs.githubDeployerClientId
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_SUBSCRIPTION_ID string = subscription().subscriptionId
