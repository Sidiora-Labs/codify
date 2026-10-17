#!/usr/bin/env python3
"""Loopback TLS relay used as a killable network segment between a client and a service.

Each accepted connection carries one HTTP/1.1 request. With --drop-first-response the relay
forwards the first /v1/invoke request, waits for the complete service response (so the service
has committed and replied) and then dies without relaying a byte: an actual network cut between
commit and acknowledgement. It holds no credentials and never alters request bytes.
"""
import argparse,json,os,socket,ssl,sys,threading
def read_message(stream):
    data=b""
    while b"\r\n\r\n" not in data:
        chunk=stream.recv(65536)
        if not chunk:raise ConnectionError("peer closed before headers")
        data+=chunk
        if len(data)>1048576:raise ConnectionError("header limit")
    head,body=data.split(b"\r\n\r\n",1)
    length=0
    for line in head.split(b"\r\n")[1:]:
        name,_,value=line.partition(b":")
        if name.strip().lower()==b"content-length":length=int(value.strip())
    while len(body)<length:
        chunk=stream.recv(65536)
        if not chunk:raise ConnectionError("peer closed before body")
        body+=chunk
    return head,body[:length]
def main():
    parser=argparse.ArgumentParser()
    for name in ("--port-file","--cert","--key","--ca","--event-file"):parser.add_argument(name,required=True)
    parser.add_argument("--target-port",type=int,required=True)
    parser.add_argument("--drop-first-response",action="store_true")
    a=parser.parse_args()
    server=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);server.minimum_version=ssl.TLSVersion.TLSv1_3;server.load_cert_chain(a.cert,a.key)
    client=ssl.create_default_context(cafile=a.ca)
    listener=socket.socket();listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);listener.bind(("127.0.0.1",0));listener.listen(64)
    with open(a.port_file+".tmp","w") as stream:stream.write(str(listener.getsockname()[1]))
    os.replace(a.port_file+".tmp",a.port_file)
    lock=threading.Lock();state={"dropped":False}
    def event(value):
        with lock:
            with open(a.event_file,"a") as stream:stream.write(json.dumps(value)+"\n");stream.flush();os.fsync(stream.fileno())
    def serve(raw):
        try:
            with server.wrap_socket(raw,server_side=True) as inbound:
                head,body=read_message(inbound)
                with client.wrap_socket(socket.create_connection(("127.0.0.1",a.target_port),timeout=30),server_hostname="localhost") as outbound:
                    outbound.sendall(head+b"\r\n\r\n"+body)
                    response_head,response_body=read_message(outbound)
                with lock:
                    drop=a.drop_first_response and not state["dropped"] and head.split(b" ")[1]==b"/v1/invoke"
                    state["dropped"]=state["dropped"] or drop
                if drop:
                    event({"event":"dropped","pid":os.getpid(),"status_line":response_head.split(b"\r\n")[0].decode(),"response_bytes":len(response_body)})
                    os._exit(17)
                inbound.sendall(response_head+b"\r\n\r\n"+response_body)
                event({"event":"relayed","pid":os.getpid(),"status_line":response_head.split(b"\r\n")[0].decode()})
        except (OSError,ConnectionError,ssl.SSLError) as error:
            event({"event":"error","pid":os.getpid(),"error":type(error).__name__})
    while True:
        raw,_=listener.accept()
        threading.Thread(target=serve,args=(raw,),daemon=True).start()
if __name__=="__main__":sys.exit(main())
