// Copyright 2016-2025, Pulumi Corporation.  All rights reserved.

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

// Minikube does not implement services of type `LoadBalancer`; require the user to specify if we're
// running on minikube, and if so, create only services of type ClusterIP.
const config = new pulumi.Config();
const isMinikube = config.getBoolean("isMinikube");
const grafanaAdminUser = "admin";
const grafanaAdminPassword = pulumi.secret("admin123");

//
// REDIS LEADER.
//

const redisLeaderLabels = { app: "redis-leader" };
const redisLeaderDeployment = new k8s.apps.v1.Deployment("redis-leader", {
    spec: {
        selector: { matchLabels: redisLeaderLabels },
        template: {
            metadata: { labels: redisLeaderLabels },
            spec: {
                containers: [
                    {
                        name: "redis-leader",
                        image: "redis",
                        resources: { requests: { cpu: "100m", memory: "100Mi" } },
                        ports: [{ containerPort: 6379 }],
                    },
                ],
            },
        },
    },
});
const redisLeaderService = new k8s.core.v1.Service("redis-leader", {
    metadata: {
        name: "redis-leader",
        labels: redisLeaderDeployment.metadata.labels,
    },
    spec: {
        ports: [{ name: "redis", port: 6379, targetPort: 6379 }],
        selector: redisLeaderDeployment.spec.template.metadata.labels,
    },
});

//
// REDIS REPLICA.
//

const redisReplicaLabels = { app: "redis-replica" };
const redisReplicaDeployment = new k8s.apps.v1.Deployment("redis-replica", {
    spec: {
        selector: { matchLabels: redisReplicaLabels },
        template: {
            metadata: { labels: redisReplicaLabels },
            spec: {
                containers: [
                    {
                        name: "replica",
                        image: "redis:7-alpine",
                        command: ["redis-server"],
                        args: ["--replicaof", "redis-leader", "6379"],
                        resources: { requests: { cpu: "100m", memory: "100Mi" } },
                        // If your cluster config does not include a dns service, then to instead access an environment
                        // variable to find the leader's host, change `value: "dns"` to read `value: "env"`.
                        env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                        ports: [{ containerPort: 6379 }],
                    },
                ],
            },
        },
    },
});
const redisReplicaService = new k8s.core.v1.Service("redis-replica", {
    metadata: {
        name: "redis-replica",
        labels: redisReplicaDeployment.metadata.labels,
    },
    spec: {
        ports: [{ name: "redis", port: 6379, targetPort: 6379 }],
        selector: redisReplicaDeployment.spec.template.metadata.labels,
    },
});

//
// FRONTEND
//

const frontendLabels = { app: "frontend" };
const frontendDeployment = new k8s.apps.v1.Deployment("frontend", {
    spec: {
        selector: { matchLabels: frontendLabels },
        replicas: 3,
        template: {
            metadata: { labels: frontendLabels },
            spec: {
                containers: [
                    {
                        name: "frontend",
                        image: "pulumi/guestbook-php-redis",
                        resources: { requests: { cpu: "100m", memory: "100Mi" } },
                        // If your cluster config does not include a dns service, then to instead access an environment
                        // variable to find the master service's host, change `value: "dns"` to read `value: "env"`.
                        env: [{ name: "GET_HOSTS_FROM", value: "dns" /* value: "env"*/ }],
                        ports: [{ containerPort: 80 }],
                    },
                ],
            },
        },
    },
});
const frontendService = new k8s.core.v1.Service("frontend", {
    metadata: {
        labels: frontendDeployment.metadata.labels,
        name: "frontend",
    },
    spec: {
        type: isMinikube ? "ClusterIP" : "LoadBalancer",
        ports: [{ name: "http", port: 80, targetPort: 80 }],
        selector: frontendDeployment.spec.template.metadata.labels,
    },
});

// Export the frontend IP.
export let frontendIp: pulumi.Output<string>;
if (isMinikube) {
    frontendIp = frontendService.spec.clusterIP;
} else {
    frontendIp = frontendService.status.loadBalancer.ingress[0].ip;
}
const monitoringNamespace = new k8s.core.v1.Namespace("monitoring", {
    metadata: {
        name: "monitoring",
    },
});
const monitoringStack = new k8s.helm.v3.Release("kube-prometheus-stack", {
    chart: "kube-prometheus-stack",
    version: "66.2.1",
    namespace: monitoringNamespace.metadata.name,
    repositoryOpts: {
        repo: "https://prometheus-community.github.io/helm-charts",
    },
    values: {
        grafana: {
            adminUser: grafanaAdminUser,
            adminPassword: grafanaAdminPassword,
            service: {
                type: "NodePort",
                nodePort: 32000,
            },
        },
        prometheus: {
            prometheusSpec: {
                serviceMonitorSelectorNilUsesHelmValues: false,
            },
        },
    },
});
const frontendServiceMonitor = new k8s.apiextensions.CustomResource("guestbook-frontend-servicemonitor", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
    metadata: {
        name: "guestbook-frontend",
        namespace: "monitoring",
        labels: {
            release: "kube-prometheus-stack",
        },
    },
    spec: {
        namespaceSelector: {
            matchNames: ["default"],
        },
        selector: {
            matchLabels: frontendDeployment.metadata.labels,
        },
        endpoints: [
            {
                port: "http",
                path: "/",
                interval: "30s",
            },
        ],
    },
}, { dependsOn: monitoringStack });
const redisLeaderServiceMonitor = new k8s.apiextensions.CustomResource("redis-leader-servicemonitor", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
    metadata: {
        name: "redis-leader",
        namespace: "monitoring",
        labels: { release: "kube-prometheus-stack" },
    },
    spec: {
        namespaceSelector: { matchNames: ["default"] },
        selector: { matchLabels: redisLeaderDeployment.metadata.labels },
        endpoints: [{ port: "redis", path: "/", interval: "30s" }],
    },
}, { dependsOn: monitoringStack });

const redisReplicaServiceMonitor = new k8s.apiextensions.CustomResource("redis-replica-servicemonitor", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
    metadata: {
        name: "redis-replica",
        namespace: "monitoring",
        labels: { release: "kube-prometheus-stack" },
    },
    spec: {
        namespaceSelector: { matchNames: ["default"] },
        selector: { matchLabels: redisReplicaDeployment.metadata.labels },
        endpoints: [{ port: "redis", path: "/", interval: "30s" }],
    },
}, { dependsOn: monitoringStack });
export const grafanaUrl = "http://localhost:32000";
export const grafanaUser = grafanaAdminUser;
export const grafanaPassword = grafanaAdminPassword;