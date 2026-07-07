# Guestbook Monitoring using Pulumi, Prometheus & Grafana

This project builds on the standard Pulumi Kubernetes Guestbook example and adds a monitoring stack on top of it using Prometheus and Grafana. The monitoring side is deployed via the `kube-prometheus-stack` Helm chart, managed through Pulumi, while the Guestbook app itself stays as-is in Kubernetes.

## What this actually does

The Guestbook (frontend + Redis leader + replica) runs in the cluster like normal. On top of that, Prometheus Operator watches for ServiceMonitor resources, which point it at the Guestbook services so it knows what to scrape. Grafana then sits on top of Prometheus as its data source.

```
Guestbook Application                      
 ├── Frontend                               
 ├── Redis Leader                           
 └── Redis Replica                          
          │                                  
          ▼                                  
     ServiceMonitors                        
          │                                  
          ▼                                  
     Prometheus                             
         │                                  
         ▼                                  
      Grafana 


## Why I did it this way

**Pulumi** - I wanted to keep the infra as actual code (TypeScript) instead of a pile of YAML, mostly so it's easier to version and reason about alongside the app.

**Helm for the monitoring stack** - No reason to hand-roll Prometheus/Grafana/Alertmanager when `kube-prometheus-stack` already does it well and is easy to upgrade later.

**ServiceMonitor** - Lets Prometheus Operator auto-discover the services instead of me manually editing scrape configs every time something changes.

## Technology Stack

- Pulumi (TypeScript)
- Kubernetes
- Helm
- Prometheus
- Grafana
- Minikube (for local testing)

## Implemented Features

- Guestbook deployed through Pulumi
- Prometheus + Grafana deployed via the official Helm chart
- A separate `monitoring` namespace so it doesn't get mixed in with the app
- ServiceMonitors set up for the frontend, redis-leader, and redis-replica
- Grafana exposed via NodePort
- Grafana connection info available as a Pulumi output

## Deployment

```bash
npm install
pulumi stack init dev
pulumi config set isMinikube true
pulumi up
```

## Checking things worked

```bash
# app
kubectl get pods
kubectl get svc

# monitoring stack
kubectl get pods -n monitoring
kubectl get svc -n monitoring
helm list -n monitoring
kubectl get servicemonitor -n monitoring

# pulumi outputs
pulumi stack output
```

## Accessing the Application

**Guestbook**

```bash
kubectl port-forward svc/frontend 8080:80
```
then open `http://localhost:8080`

**Grafana**

```bash
kubectl get svc -n monitoring
# or
minikube service <grafana-service> -n monitoring
```

Default login is `admin` / `admin123` (change this if it's going anywhere beyond your laptop).

**Prometheus**

```bash
kubectl port-forward -n monitoring svc/<prometheus-service> 9090:9090
```
then open `http://localhost:9090`

## On the monitoring itself

Prometheus finds the Guestbook services through the ServiceMonitors and scrapes them. Grafana pulls from Prometheus to show the usual Kubernetes-level stuff - CPU, memory, pod health, restarts, deployment status.

One thing worth calling out: the Guestbook app itself doesn't expose a `/metrics` endpoint, since it was never built with Prometheus in mind. So service discovery works fine, but there's no request count or latency data coming from the app - that would need actual instrumentation or an exporter sitting in front of it.

## What I'd add next if I kept going

- Instrument Guestbook itself so it exposes real app metrics
- Add a Redis exporter for actual Redis metrics instead of just pod-level stats
- Wire up Alertmanager so it actually notifies someone
- Put this behind an Ingress with TLS instead of NodePort/port-forwarding
- Move the Grafana credentials into a proper secrets manager instead of hardcoding them

## Repository Contents

- `index.ts` (Pulumi source)
- Pulumi config files
- This README
- Screenshots: Guestbook running, Grafana dashboard, Prometheus targets, `kubectl get pods -n monitoring`, `pulumi stack output`
