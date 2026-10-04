/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import '@xyflow/react/dist/style.css';

import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  Background,
  Controls,
  type Edge,
  type Node,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import {
  Alert,
  Button,
  Divider,
  Drawer,
  List,
  Spin,
  Tag,
  theme,
  Typography,
} from 'antd';
import dagre from 'dagre';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getTopologyData, type TopologyData } from '@/apis/topology';
import PageHeader from '@/components/page/PageHeader';
import { ReferenceDiagnostics } from '@/components/page/ReferenceDiagnostics';
import { useThemeMode } from '@/stores/global';

const NODE_WIDTH = 260;
const NODE_HEIGHT = 60;

const NODE_COLORS_LIGHT: Record<string, { bg: string; border: string; tag: string }> = {
  route: { bg: '#e6f4ff', border: '#1677ff', tag: 'blue' },
  streamRoute: { bg: '#e6fffb', border: '#13c2c2', tag: 'cyan' },
  service: { bg: '#f6ffed', border: '#52c41a', tag: 'green' },
  upstream: { bg: '#f9f0ff', border: '#722ed1', tag: 'purple' },
};

const NODE_COLORS_DARK: Record<string, { bg: string; border: string; tag: string }> = {
  route: { bg: '#111a2c', border: '#1668dc', tag: 'blue' },
  streamRoute: { bg: '#112123', border: '#13a8a8', tag: 'cyan' },
  service: { bg: '#162312', border: '#49aa19', tag: 'green' },
  upstream: { bg: '#1a1325', border: '#642ab5', tag: 'purple' },
};

function buildGraphLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 30, ranksep: 80 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}

function buildNodesAndEdges(data: TopologyData, nodeColors: NodeColorSet): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Upstream nodes
  for (const u of data.upstreams) {
    nodes.push({
      id: `upstream-${u.id}`,
      type: 'default',
      data: {
        label: (
          <NodeLabel
            type="upstream"
            name={u.name || u.id}
            detail={summarizeTargets(u.nodes)}
            nodeColors={nodeColors}
          />
        ),
      },
      position: { x: 0, y: 0 },
      style: nodeStyle('upstream', nodeColors),
    });
  }

  // Service nodes
  for (const s of data.services) {
    nodes.push({
      id: `service-${s.id}`,
      type: 'default',
      data: {
        label: (
          <NodeLabel
            type="service"
            name={s.name || s.id}
            detail={s.hasInlineUpstream ? `inline: ${summarizeTargets(s.inlineUpstreamTargets)}` : ''}
            nodeColors={nodeColors}
          />
        ),
      },
      position: { x: 0, y: 0 },
      style: nodeStyle('service', nodeColors),
    });

    if (s.upstream_id) {
      edges.push({
        id: `service-${s.id}->upstream-${s.upstream_id}`,
        source: `service-${s.id}`,
        target: `upstream-${s.upstream_id}`,
        animated: true,
        style: { stroke: '#722ed1' },
      });
    }
  }

  // Route nodes
  for (const r of data.routes) {
    nodes.push({
      id: `route-${r.id}`,
      type: 'default',
      data: {
        label: (
          <NodeLabel
            type="route"
            name={r.name || r.id}
            detail={r.uri || ''}
            nodeColors={nodeColors}
          />
        ),
      },
      position: { x: 0, y: 0 },
      style: nodeStyle('route', nodeColors),
    });

    if (r.service_id) {
      edges.push({
        id: `route-${r.id}->service-${r.service_id}`,
        source: `route-${r.id}`,
        target: `service-${r.service_id}`,
        animated: true,
        style: { stroke: '#52c41a' },
      });
    }
    if (r.upstream_id) {
      edges.push({
        id: `route-${r.id}->upstream-${r.upstream_id}`,
        source: `route-${r.id}`,
        target: `upstream-${r.upstream_id}`,
        animated: true,
        style: { stroke: '#722ed1' },
      });
    }
  }

  // Stream Route nodes
  for (const r of data.streamRoutes) {
    nodes.push({
      id: `stream-route-${r.id}`,
      type: 'default',
      data: {
        label: (
          <NodeLabel
            type="streamRoute"
            name={r.name || r.id}
            detail={r.hasInlineUpstream ? `inline: ${summarizeTargets(r.inlineUpstreamTargets)}` : ''}
            nodeColors={nodeColors}
          />
        ),
      },
      position: { x: 0, y: 0 },
      style: nodeStyle('streamRoute', nodeColors),
    });

    if (r.service_id) {
      edges.push({
        id: `stream-route-${r.id}->service-${r.service_id}`,
        source: `stream-route-${r.id}`,
        target: `service-${r.service_id}`,
        animated: true,
        style: { stroke: '#52c41a' },
      });
    }
    if (r.upstream_id) {
      edges.push({
        id: `stream-route-${r.id}->upstream-${r.upstream_id}`,
        source: `stream-route-${r.id}`,
        target: `upstream-${r.upstream_id}`,
        animated: true,
        style: { stroke: '#722ed1' },
      });
    }
  }

  const layoutNodes = buildGraphLayout(nodes, edges);
  return { nodes: layoutNodes, edges };
}

type NodeColorSet = Record<string, { bg: string; border: string; tag: string }>;

function nodeStyle(type: string, nodeColors: NodeColorSet): React.CSSProperties {
  const colors = nodeColors[type] ?? nodeColors.route;
  return {
    background: colors.bg,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: 8,
    padding: '8px 12px',
    width: NODE_WIDTH,
    fontSize: 'var(--app-font-size-sm)',
  };
}

function summarizeTargets(targets: string[]): string {
  if (!targets.length) return '';
  return targets.slice(0, 2).join(', ') + (targets.length > 2 ? '...' : '');
}

function InlineUpstreamTargets({ targets }: { targets: string[] }) {
  if (!targets.length) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <Tag color="orange" style={{ marginBottom: 4 }}>Inline Target</Tag>
      <List
        size="small"
        dataSource={targets}
        renderItem={(item: string) => (
          <List.Item style={{ padding: '2px 0', border: 'none' }}>
            <Typography.Text code style={{ fontSize: 'var(--app-font-size-xs)' }}>{item}</Typography.Text>
          </List.Item>
        )}
      />
    </div>
  );
}

function NodeLabel({ type, name, detail, nodeColors }: { type: string; name: string; detail: string; nodeColors: NodeColorSet }) {
  const colors = nodeColors[type] ?? nodeColors.route;
  const typeLabels: Record<string, string> = {
    route: 'Route',
    streamRoute: 'Stream',
    service: 'Service',
    upstream: 'Upstream',
  };
  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
        <Tag color={colors.tag} style={{ margin: 0, fontSize: 'var(--app-font-size-2xs)', lineHeight: '16px', padding: '0 4px' }}>
          {typeLabels[type] ?? type}
        </Tag>
        <Typography.Text
          strong
          ellipsis
          title={name}
          style={{ fontSize: 'var(--app-font-size-sm)', maxWidth: 185 }}
        >
          {name}
        </Typography.Text>
      </div>
      {detail && (
        <Typography.Text
          type="secondary"
          ellipsis
          title={detail}
          style={{ fontSize: 'var(--app-font-size-2xs)', display: 'block' }}
        >
          {detail}
        </Typography.Text>
      )}
    </div>
  );
}

function TopologyGraph({ data }: { data: TopologyData }) {
  const { token } = theme.useToken();
  const { mode } = useThemeMode();
  const navigate = useNavigate();
  const { fitView } = useReactFlow();
  const nodeColors = mode === 'dark' ? NODE_COLORS_DARK : NODE_COLORS_LIGHT;

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildNodesAndEdges(data, nodeColors),
    [data, nodeColors]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const isEmpty = nodes.length === 0;

  const onInit = useCallback(() => {
    fitView({ padding: 0.15, duration: 400 });
  }, [fitView]);

  const renderedEdges = useMemo(() => {
    return edges.map((edge) => {
      const isDirectlyHovered = edge.id === hoveredEdgeId;
      const isConnectedToHoveredNode = hoveredNodeId && (edge.source === hoveredNodeId || edge.target === hoveredNodeId);
      const active = isDirectlyHovered || isConnectedToHoveredNode;
      return {
        ...edge,
        animated: !!(edge.animated || active),
        style: {
          ...edge.style,
          strokeWidth: active ? 3.5 : 2,
          stroke: active ? 'var(--ant-color-primary)' : edge.style?.stroke,
          transition: 'stroke 0.2s, stroke-width 0.2s',
        },
        className: active ? 'dashed-flow-edge-hovered' : undefined,
      };
    });
  }, [edges, hoveredEdgeId, hoveredNodeId]);

  const renderedNodes = useMemo(() => {
    return nodes.map((node) => {
      const isHovered = node.id === hoveredNodeId;
      const isSelected = node.id === selectedNodeId;
      const isConnectedToHoveredEdge = hoveredEdgeId && (
        edges.find(e => e.id === hoveredEdgeId)?.source === node.id ||
        edges.find(e => e.id === hoveredEdgeId)?.target === node.id
      );
      const highlight = isHovered || isConnectedToHoveredEdge || isSelected;
      return {
        ...node,
        style: {
          ...node.style,
          transition: 'box-shadow 0.2s ease-in-out, border-color 0.2s ease-in-out',
          boxShadow: highlight ? '0 0 12px var(--ant-color-primary)' : 'none',
          borderColor: highlight ? 'var(--ant-color-primary)' : (node.style as React.CSSProperties)?.borderColor,
          cursor: 'pointer',
        },
      };
    });
  }, [nodes, hoveredNodeId, hoveredEdgeId, selectedNodeId, edges]);

  const selectedResource = useMemo(() => {
    if (!selectedNodeId) return null;
    const id = selectedNodeId;
    if (id.startsWith('route-')) {
      const targetId = id.slice(6);
      const res = data.routes.find((r) => r.id === targetId);
      return res ? { type: 'Route', data: res, edit: () => { navigate({ to: '/routes/detail/$id', params: { id: targetId } }); } } : null;
    }
    if (id.startsWith('service-')) {
      const targetId = id.slice(8);
      const res = data.services.find((s) => s.id === targetId);
      return res ? { type: 'Service', data: res, edit: () => { navigate({ to: '/services/detail/$id', params: { id: targetId } }); } } : null;
    }
    if (id.startsWith('upstream-')) {
      const targetId = id.slice(9);
      const res = data.upstreams.find((u) => u.id === targetId);
      return res ? { type: 'Upstream', data: res, edit: () => { navigate({ to: '/upstreams/detail/$id', params: { id: targetId } }); } } : null;
    }
    if (id.startsWith('stream-route-')) {
      const targetId = id.slice(13);
      const res = data.streamRoutes.find((r) => r.id === targetId);
      return res ? { type: 'Stream Route', data: res, edit: () => { navigate({ to: '/stream_routes/detail/$id', params: { id: targetId } }); } } : null;
    }
    return null;
  }, [selectedNodeId, data, navigate]);

  const routeData = selectedResource?.type === 'Route' ? selectedResource.data as TopologyData['routes'][number] : null;
  const streamRouteData = selectedResource?.type === 'Stream Route' ? selectedResource.data as TopologyData['streamRoutes'][number] : null;
  const serviceData = selectedResource?.type === 'Service' ? selectedResource.data as TopologyData['services'][number] : null;
  const upstreamData = selectedResource?.type === 'Upstream' ? selectedResource.data as TopologyData['upstreams'][number] : null;

  if (isEmpty) {
    return (
      <div style={{
        height: 'calc(100vh - 200px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px dashed ${token.colorBorderSecondary}`,
        borderRadius: 8,
      }}>
        <Typography.Text type="secondary">
          No resources found. Create routes, stream routes, services, or upstreams to see the topology.
        </Typography.Text>
      </div>
    );
  }

  return (
    <div style={{ height: 'calc(100vh - 200px)', border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, position: 'relative', overflow: 'hidden' }}>
      <ReactFlow
        nodes={renderedNodes}
        edges={renderedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={onInit}
        onNodeClick={(_, node) => {
          setSelectedNodeId(node.id);
          // Center the viewport on the clicked node with smooth animation
          fitView({ nodes: [{ id: node.id }], duration: 400, padding: 0.5, maxZoom: 1.5 });
        }}
        onPaneClick={() => {
          setSelectedNodeId(null);
        }}
        onNodeMouseEnter={(_, node) => {
          setHoveredNodeId(node.id);
        }}
        onNodeMouseLeave={() => {
          setHoveredNodeId(null);
        }}
        onEdgeMouseEnter={(_, edge) => {
          setHoveredEdgeId(edge.id);
        }}
        onEdgeMouseLeave={() => {
          setHoveredEdgeId(null);
        }}
        onNodeDoubleClick={(_, node) => {
          const id = node.id;
          if (id.startsWith('route-')) navigate({ to: '/routes/detail/$id', params: { id: id.slice(6) } });
          else if (id.startsWith('service-')) navigate({ to: '/services/detail/$id', params: { id: id.slice(8) } });
          else if (id.startsWith('upstream-')) navigate({ to: '/upstreams/detail/$id', params: { id: id.slice(9) } });
          else if (id.startsWith('stream-route-')) navigate({ to: '/stream_routes/detail/$id', params: { id: id.slice(13) } });
        }}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background gap={16} size={1} />
        <Controls />
        <Panel position="top-right">
          <div style={{
            background: token.colorBgContainer,
            padding: '8px 12px',
            borderRadius: 6,
            border: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            gap: 8,
            fontSize: 'var(--app-font-size-sm)',
          }}>
            <Tag color="blue">Route ({data.routes.length})</Tag>
            <Tag color="cyan">Stream Route ({data.streamRoutes.length})</Tag>
            <Tag color="green">Service ({data.services.length})</Tag>
            <Tag color="purple">Upstream ({data.upstreams.length})</Tag>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-xs)', marginTop: 4, display: 'block' }}>
            Click a node to open quick view. Double-click to open its detail page.
          </Typography.Text>
        </Panel>
      </ReactFlow>

      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color={
              selectedResource?.type === 'Route' ? 'blue' :
              selectedResource?.type === 'Stream Route' ? 'cyan' :
              selectedResource?.type === 'Service' ? 'green' : 'purple'
            }>
              {selectedResource?.type}
            </Tag>
            <Typography.Text strong style={{ fontSize: 'var(--app-font-size-base)' }}>
              {selectedResource?.data?.name || selectedResource?.data?.id}
            </Typography.Text>
          </div>
        }
        open={!!selectedNodeId}
        onClose={() => setSelectedNodeId(null)}
        styles={{ wrapper: { width: 350 } }}
        mask={false}
        getContainer={false}
        rootStyle={{
          position: 'absolute',
          boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.08)',
          borderLeft: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        {selectedResource && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-xs)', display: 'block', marginBottom: 2 }}>ID</Typography.Text>
                <Typography.Text code style={{ fontSize: 'var(--app-font-size-sm)' }}>{selectedResource.data.id}</Typography.Text>
              </div>

              {selectedResource.data.name && (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-xs)', display: 'block', marginBottom: 2 }}>Name</Typography.Text>
                  <Typography.Text strong style={{ fontSize: 'var(--app-font-size-md)' }}>{selectedResource.data.name}</Typography.Text>
                </div>
              )}

              {routeData && (
                <>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-xs)', display: 'block', marginBottom: 2 }}>URI Path</Typography.Text>
                    <Typography.Text code style={{ fontSize: 'var(--app-font-size-sm)' }}>{routeData.uri || '/'}</Typography.Text>
                  </div>

                  <Divider style={{ margin: '8px 0' }} />
                  <Typography.Text strong style={{ fontSize: 'var(--app-font-size-sm)', display: 'block' }}>Connected Resources</Typography.Text>

                  {routeData.service_id && (
                    <div style={{ marginTop: 4 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-xs)', display: 'block' }}>Service Link</Typography.Text>
                      <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 'var(--app-font-size-sm)' }} onClick={() => setSelectedNodeId(`service-${routeData.service_id}`)}>
                        service-{routeData.service_id}
                      </Button>
                    </div>
                  )}

                  {routeData.upstream_id && (
                    <div style={{ marginTop: 4 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-xs)', display: 'block' }}>Upstream Link</Typography.Text>
                      <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 'var(--app-font-size-sm)' }} onClick={() => setSelectedNodeId(`upstream-${routeData.upstream_id}`)}>
                        upstream-{routeData.upstream_id}
                      </Button>
                    </div>
                  )}

                  <InlineUpstreamTargets targets={routeData.inlineUpstreamTargets} />
                </>
              )}

              {streamRouteData && (
                <>
                  <Divider style={{ margin: '8px 0' }} />
                  <Typography.Text strong style={{ fontSize: 'var(--app-font-size-sm)', display: 'block' }}>Connected Resources</Typography.Text>

                  {streamRouteData.service_id && (
                    <div style={{ marginTop: 4 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-xs)', display: 'block' }}>Service Link</Typography.Text>
                      <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 'var(--app-font-size-sm)' }} onClick={() => setSelectedNodeId(`service-${streamRouteData.service_id}`)}>
                        service-{streamRouteData.service_id}
                      </Button>
                    </div>
                  )}

                  {streamRouteData.upstream_id && (
                    <div style={{ marginTop: 4 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-xs)', display: 'block' }}>Upstream Link</Typography.Text>
                      <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 'var(--app-font-size-sm)' }} onClick={() => setSelectedNodeId(`upstream-${streamRouteData.upstream_id}`)}>
                        upstream-{streamRouteData.upstream_id}
                      </Button>
                    </div>
                  )}

                  <InlineUpstreamTargets targets={streamRouteData.inlineUpstreamTargets} />
                </>
              )}

              {serviceData && (
                <>
                  <Divider style={{ margin: '8px 0' }} />
                  <Typography.Text strong style={{ fontSize: 'var(--app-font-size-sm)', display: 'block' }}>Connected Resources</Typography.Text>

                  {serviceData.upstream_id && (
                    <div style={{ marginTop: 4 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-xs)', display: 'block' }}>Upstream Link</Typography.Text>
                      <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 'var(--app-font-size-sm)' }} onClick={() => setSelectedNodeId(`upstream-${serviceData.upstream_id}`)}>
                        upstream-{serviceData.upstream_id}
                      </Button>
                    </div>
                  )}

                  <InlineUpstreamTargets targets={serviceData.inlineUpstreamTargets} />
                </>
              )}

              {upstreamData && (
                <>
                  <Divider style={{ margin: '8px 0' }} />
                  <Typography.Text strong style={{ fontSize: 'var(--app-font-size-sm)', display: 'block', marginBottom: 4 }}>Targets</Typography.Text>
                  {(upstreamData.nodes || []).length > 0 ? (
                    <List
                      size="small"
                      dataSource={upstreamData.nodes}
                      renderItem={(item: string) => (
                        <List.Item style={{ padding: '2px 0', border: 'none' }}>
                          <Typography.Text code style={{ fontSize: 'var(--app-font-size-xs)' }}>{item}</Typography.Text>
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-xs)' }}>No targets specified</Typography.Text>
                  )}
                </>
              )}
            </div>

            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button type="primary" block onClick={selectedResource.edit}>
                Edit Configuration
              </Button>
              <Button block onClick={() => setSelectedNodeId(null)}>
                Close Quick View
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function TopologyPage() {
  const {
    data,
    error,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['topology'],
    queryFn: getTopologyData,
    staleTime: 30_000,
  });

  return (
    <>
      <PageHeader
        title="Service Topology"
        extra={<ReferenceDiagnostics />}
        desc="Visualize connections between Routes, Stream Routes, Services, and Upstreams"
      />
      {isError ? (
        <Alert
          type="warning"
          showIcon
          title="Topology unavailable"
          description={
            error instanceof Error
              ? error.message
              : 'The dashboard could not load topology data from the APISIX Admin API.'
          }
          action={
            <Button
              size="small"
              loading={isFetching}
              onClick={() => void refetch()}
            >
              Retry
            </Button>
          }
        />
      ) : isLoading || !data ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          {!!data.unavailableResources.length && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              title="Topology data is incomplete"
              description={`Could not load: ${data.unavailableResources.join(', ')}. The graph may omit affected links.`}
              action={
                <Button
                  size="small"
                  loading={isFetching}
                  onClick={() => void refetch()}
                >
                  Retry
                </Button>
              }
            />
          )}
          <ReactFlowProvider>
            <TopologyGraph data={data} />
          </ReactFlowProvider>
        </>
      )}
    </>
  );
}

export const Route = createFileRoute('/topology/')({
  component: TopologyPage,
});
