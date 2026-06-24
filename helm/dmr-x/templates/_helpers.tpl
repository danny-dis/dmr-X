{{/*
Expand the name of the chart.
*/}}
{{- define "dmr-x.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "dmr-x.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "dmr-x.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "dmr-x.labels" -}}
helm.sh/chart: {{ include "dmr-x.chart" . }}
{{ include "dmr-x.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "dmr-x.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dmr-x.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "dmr-x.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "dmr-x.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Namespace
*/}}
{{- define "dmr-x.namespace" -}}
{{- default .Release.Namespace .Values.namespace }}
{{- end }}

{{/*
Create environment variables for the gateway
*/}}
{{- define "dmr-x.envVars" -}}
- name: NODE_ENV
  value: {{ .Values.dmrx.environment | quote }}
- name: PORT
  value: {{ .Values.service.port | quote }}
- name: LOG_LEVEL
  value: {{ .Values.dmrx.logLevel | quote }}
- name: DMRX_LOCAL_MODE
  value: {{ .Values.dmrx.localMode | quote }}
- name: DMRX_DATA_DIR
  value: {{ .Values.dmrx.dataDir | quote }}
- name: DMRX_RATE_LIMIT_MAX
  value: {{ .Values.dmrx.rateLimit.max | quote }}
- name: DMRX_RATE_LIMIT_WINDOW
  value: {{ .Values.dmrx.rateLimit.window | quote }}
- name: DMRX_BODY_LIMIT
  value: {{ .Values.dmrx.bodyLimit | quote }}
- name: DMRX_REQUEST_TIMEOUT
  value: {{ .Values.dmrx.requestTimeout | quote }}
{{- if .Values.dmrx.adminApiKey }}
- name: DMRX_ADMIN_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "dmr-x.fullname" . }}-secrets
      key: admin-api-key
{{- end }}
{{- if .Values.dmrx.encryptionKey }}
- name: DMRX_ENCRYPTION_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "dmr-x.fullname" . }}-secrets
      key: encryption-key
{{- end }}
{{- if .Values.dmrx.corsOrigin }}
- name: DMRX_CORS_ORIGIN
  value: {{ .Values.dmrx.corsOrigin | quote }}
{{- end }}
{{- range $name, $config := .Values.providers }}
{{- if $config.apiKey }}
- name: {{ $name | upper }}_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "dmr-x.fullname" $ }}-secrets
      key: {{ $name }}-api-key
{{- end }}
{{- end }}
{{- end }}
