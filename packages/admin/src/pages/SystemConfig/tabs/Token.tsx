import { createApiToken, getAllApiTokens, deleteApiToken } from '@/services/van-blog/api';
import { ModalForm, ProFormText, ProTable } from '@ant-design/pro-components';
import type { ActionType } from '@ant-design/pro-components';
import { Button, Card, message, Modal, Space, Typography } from 'antd';
import copy from 'copy-to-clipboard';

import { useRef } from 'react';
import { useModel } from 'umi';

function McpConnection({ endpoint, token = '<API_TOKEN>' }: { endpoint: string; token?: string }) {
  const config = JSON.stringify(
    {
      mcpServers: {
        vanblog: {
          url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <>
      <Typography.Paragraph>
        使用支持 Streamable HTTP 和自定义请求头的 MCP 客户端，将下面的配置添加到客户端的 MCP 设置中。
      </Typography.Paragraph>
      <Typography.Paragraph>
        服务地址：
        <Typography.Text code copyable style={{ wordBreak: 'break-all' }}>
          {endpoint}
        </Typography.Text>
      </Typography.Paragraph>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{config}</pre>
      <Button
        type="primary"
        onClick={() => {
          if (copy(config)) message.success('MCP 配置已复制');
          else message.error('复制失败，请手动复制上方配置');
        }}
      >
        复制配置
      </Button>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
        MCP 复用 API Token，可查询文章、管理草稿、上传图片和发布文章。删除 Token 后，对应的 MCP
        连接也会失效。
      </Typography.Paragraph>
    </>
  );
}

const columns = (endpoint: string) => [
  { dataIndex: '_id', title: 'ID' },
  { dataIndex: 'name', title: '名称' },
  {
    dataIndex: 'token',
    title: '内容',
    render: (token) => {
      return (
        <Typography.Text style={{ maxWidth: 250 }} ellipsis={true} copyable={true}>
          {token}
        </Typography.Text>
      );
    },
  },
  {
    title: '操作',
    render: (text, record, _, action) => [
      <a
        key="mcp"
        onClick={() => {
          Modal.info({
            title: `${record.name} · MCP 接入`,
            width: 720,
            style: { maxWidth: 'calc(100vw - 32px)' },
            content: <McpConnection endpoint={endpoint} token={record.token} />,
            okText: '关闭',
          });
        }}
      >
        接入 MCP
      </a>,
      <a
        key="delete"
        style={{ marginLeft: 8 }}
        onClick={() => {
          Modal.confirm({
            title: '删除确认',
            content: '是否确认删除该 Token？',
            onOk: async () => {
              await deleteApiToken(record._id);
              action?.reload();
              message.success('删除成功！');
            },
          });
        }}
      >
        删除
      </a>,
    ],
  },
];
export default function () {
  const actionRef = useRef<ActionType>();
  const { initialState } = useModel('@@initialState');
  let endpoint = new URL('/api/mcp', window.location.origin).href;
  try {
    const siteUrl = new URL(initialState?.baseUrl);
    if (siteUrl.protocol === 'https:' || siteUrl.protocol === 'http:') {
      endpoint = new URL('/api/mcp', siteUrl).href;
    }
  } catch {
    // Use the current origin when the public site URL has not been configured.
  }
  return (
    <>
      <Card
        title="Token 管理"
        style={{ marginTop: 8 }}
        className="card-body-full"
        extra={
          <Space wrap>
            <ModalForm
              title="新建 API Token"
              trigger={<Button type="primary"> 新建</Button>}
              onFinish={async (vals) => {
                await createApiToken(vals);
                actionRef.current?.reload();
                return true;
              }}
            >
              <ProFormText label="名称" name="name" />
            </ModalForm>
            <Button
              onClick={() => {
                window.open('/swagger', '_blank');
              }}
            >
              API 文档
            </Button>
            <Button
              onClick={() => {
                Modal.info({
                  title: 'Token 管理功能介绍',
                  content: (
                    <div>
                      <p>创建的 API Token 可以用来调用 VanBlog 的 API，也可以用于 MCP 接入。</p>
                      <p>
                        点击 Token 右侧的“接入 MCP”，即可复制包含该 Token 的客户端配置。
                        AI 可以查询文章、编写草稿、上传图片和发布内容。
                      </p>
                      <p>
                        API 请求使用 token 请求头；MCP 请求使用 Authorization: Bearer 请求头。
                        两者使用同一个 API Token，删除 Token 后均会失效。
                      </p>
                      <p>
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href="https://vanblog.mereith.com/advanced/token.html"
                        >
                          相关文档
                        </a>
                      </p>
                    </div>
                  ),
                });
              }}
            >
              帮助
            </Button>
          </Space>
        }
      >
        <ProTable
          rowKey="_id"
          columns={columns(endpoint)}
          scroll={{ x: 'max-content' }}
          dateFormatter="string"
          actionRef={actionRef}
          search={false}
          options={false}
          pagination={{
            hideOnSinglePage: true,
            simple: true,
          }}
          request={async () => {
            const { data = [] } = await getAllApiTokens();
            return {
              data,
              // success 请返回 true，
              // 不然 table 会停止解析数据，即使有数据
              success: true,
              // 不传会使用 data 的长度，如果是分页一定要传
              total: data.length,
            };
          }}
        />
      </Card>
      <Card title="MCP 接入" style={{ marginTop: 16 }}>
        <Typography.Paragraph>
          创建 API Token 后，将配置中的 &lt;API_TOKEN&gt; 替换为 Token 内容；也可以点击上方 Token
          右侧的“接入 MCP”，直接生成包含该 Token 的配置。
        </Typography.Paragraph>
        <McpConnection endpoint={endpoint} />
      </Card>
    </>
  );
}
