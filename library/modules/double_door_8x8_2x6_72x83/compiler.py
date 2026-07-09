from seh_lib import build_instance_into_doc, instance_from_schema


def compile(schema, doc):
    instance = instance_from_schema(schema)
    build_instance_into_doc(instance, doc)
    return list(doc.Objects)
